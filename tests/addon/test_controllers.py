"""Run the real Bash controllers with stepped sleeps and fake service tools."""
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]
SERVICES = ROOT / 'famalio_home/rootfs/etc/s6-overlay/s6-rc.d'
GENERATION = '12345678-1234-4123-8123-123456789abc'
NEXT_GENERATION = '22345678-1234-4123-8123-123456789abc'


class Controller:
    def __init__(self, service, environment):
        self.process = subprocess.Popen(
            ['bash', str(SERVICES / service / 'run')], env=environment,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        self.pending = b''
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)

    def tick(self, advance=True):
        if advance:
            self.process.stdin.write(b'next\n')
            self.process.stdin.flush()
        deadline = time.monotonic() + 10
        while True:
            if b'\n' in self.pending:
                line, self.pending = self.pending.split(b'\n', 1)
                if line.startswith(b'TEST_TICK '):
                    return int(line.split()[1])
                continue
            if not self.selector.select(max(0, deadline - time.monotonic())):
                raise AssertionError('Controller did not reach the next sleep')
            chunk = os.read(self.process.stdout.fileno(), 4096)
            if not chunk:
                raise AssertionError(self.process.stderr.read().decode())
            self.pending += chunk

    def close(self):
        self.process.terminate()
        try:
            self.process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.communicate()
        self.selector.close()


@unittest.skipUnless(shutil.which('node'), 'Node is required to run the real validator')
class Controllers(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.work = Path(tmp.name)
        self.bin = self.work / 'bin'
        self.bin.mkdir()
        self.config = self.work / 'config.json'
        self.applied = self.work / 'applied'
        self.node_calls = self.work / 'node.calls'
        self.service_calls = self.work / 'service.calls'
        self.ts_calls = self.work / 'tailscale.calls'
        self.ts_state = self.work / 'tailscale.json'
        self.tool('node', f'#!/bin/sh\necho parse >>"$NODE_CALLS"\nexec "{shutil.which("node")}" "$@"\n')
        self.tool('s6-svc', '#!/bin/sh\necho "$*" >>"$SERVICE_CALLS"\n')
        self.tool('setuidgid', '#!/bin/sh\nshift\nexec "$@"\n')
        env_file = self.work / 'env.sh'
        env_file.write_text('''
sleep() { printf 'TEST_TICK %s\\n' "$1"; read -r _; }
remote_access_mode() { echo tailscale; }
opt_str() { echo ''; }
# This harness exercises maintenance, not daemon/socket startup. Only the
# socket prerequisite is stubbed; all other file and value tests are real.
[() { if [[ "$1" = -S && "$2" = "$TS_SOCKET" ]]; then return 0; fi; builtin [ "$@"; }
''')
        self.environment = dict(
            os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}',
            FAMALIO_ENV_SH=str(env_file), FAMALIO_SETUP_CONFIG=str(self.config),
            FAMALIO_SETUP_APPLIED=str(self.applied), FAMALIO_SETUP_DIR=str(self.work),
            NODE_CALLS=str(self.node_calls), SERVICE_CALLS=str(self.service_calls),
            TS_CALLS=str(self.ts_calls), TS_STATE=str(self.ts_state),
            TS_RUN_DIR=str(self.work), TS_SOCKET=str(self.work / 'tailscaled.sock'),
            FAMALIO_SETUIDGID=str(self.bin / 'setuidgid'), FAMALIO_TS_USER='test',
            TAILSCALE_BIN=str(self.bin / 'tailscale'),
        )

    def tool(self, name, content):
        file = self.bin / name
        file.write_text(content)
        file.chmod(0o755)

    def start(self, service):
        controller = Controller(service, self.environment)
        self.addCleanup(controller.close)
        return controller

    @staticmethod
    def count(file):
        return len(file.read_text().splitlines()) if file.exists() else 0

    def write(self, value):
        replacement = self.work / 'replacement.json'
        replacement.write_text(json.dumps(value))
        replacement.replace(self.config)

    def valid(self, generation=GENERATION, **extra):
        return dict(version=1, generation=generation, mode='tailscale', **extra)

    def test_idle_config_is_parsed_once_and_service_restarts_only_once(self):
        self.write(self.valid())
        controller = self.start('setup-apply')
        self.assertEqual(controller.tick(False), 2)
        for _ in range(30):
            self.assertEqual(controller.tick(), 2)
        self.assertEqual(self.count(self.node_calls), 1)
        self.assertEqual(self.count(self.service_calls), 3)
        self.assertEqual(self.applied.stat().st_mode & 0o777, 0o600)

    def test_changes_including_same_size_and_preserved_mtime_are_detected(self):
        self.write(self.valid())
        controller = self.start('setup-apply')
        controller.tick(False)
        original = self.config.stat()
        self.config.write_text(json.dumps(self.valid(NEXT_GENERATION)))
        os.utime(self.config, ns=(original.st_atime_ns, original.st_mtime_ns))
        controller.tick()
        self.assertEqual(self.count(self.node_calls), 2)
        self.assertEqual(self.count(self.service_calls), 6)
        self.write(self.valid())
        controller.tick()
        self.assertEqual(self.count(self.node_calls), 3)
        self.assertEqual(self.count(self.service_calls), 9)

    def test_invalid_or_removed_config_does_not_reuse_cached_generation(self):
        self.write(self.valid())
        controller = self.start('setup-apply')
        controller.tick(False)
        self.applied.unlink()
        self.config.write_text('{invalid')
        controller.tick()
        controller.tick()
        self.assertEqual(self.count(self.node_calls), 2)
        self.assertEqual(self.count(self.service_calls), 3)
        self.config.unlink()
        controller.tick()
        self.assertEqual(self.count(self.service_calls), 3)
        self.write(self.valid(NEXT_GENERATION))
        controller.tick()
        self.assertEqual(self.count(self.service_calls), 6)

    def test_missing_startup_and_already_applied_generation_do_not_restart(self):
        self.applied.write_text(GENERATION + '\n')
        controller = self.start('setup-apply')
        controller.tick(False)
        self.assertEqual(self.count(self.node_calls), 0)
        self.write(self.valid())
        controller.tick()
        self.assertEqual(self.count(self.node_calls), 1)
        self.assertEqual(self.count(self.service_calls), 0)

    def test_invalid_configs_and_proxy_urls_are_rejected(self):
        controller = self.start('setup-apply')
        controller.tick(False)
        for invalid in [
            self.valid() | {'version': 2}, self.valid() | {'generation': 'bad'},
            self.valid() | {'mode': 'disabled'},
            *[self.valid() | {'mode': 'reverse_proxy', 'https_url': url} for url in (
                'http://example.com', 'https://user:password@example.com',
                'https://example.com/?secret=x', 'https://example.com/#fragment',
            )],
        ]:
            self.write(invalid)
            controller.tick()
            self.assertEqual(self.count(self.service_calls), 0)
        self.write(self.valid() | {'mode': 'reverse_proxy', 'https_url': 'https://example.com'})
        controller.tick()
        self.assertEqual(self.count(self.service_calls), 3)

    def tailscale(self, **state):
        self.ts_state.write_text(json.dumps(dict(backend='Running', safe=True, repair=True, funnel=False) | state))
        self.tool('tailscale', '''#!/usr/bin/env python3
import json, os, sys, time
from pathlib import Path
file = Path(os.environ['TS_STATE'])
state = json.loads(file.read_text())
args = sys.argv[2:]
with open(os.environ['TS_CALLS'], 'a') as log: log.write(' '.join(args) + '\\n')
if args == ['status', '--json']:
    if state.get('stall_status'): time.sleep(60)
    print(json.dumps({'BackendState': state['backend'], 'Self': {'DNSName': 'famalio.example.ts.net.'}}))
elif args == ['serve', 'status', '--json']:
    result = {'Web': {'famalio.example.ts.net:443': {'Handlers': {'/': {'Proxy': 'http://127.0.0.1:8787'}}}}} if state['safe'] else {}
    if state['funnel']: result['AllowFunnel'] = {'famalio.example.ts.net:443': True}
    print(json.dumps(result))
elif args == ['serve', 'reset']:
    state['safe'] = False
    file.write_text(json.dumps(state))
elif args[:2] == ['serve', '--bg']:
    if state['repair']:
        state['safe'] = True
        file.write_text(json.dumps(state))
    else:
        print('Enable HTTPS certificates for this tailnet', file=sys.stderr)
        sys.exit(1)
''')
        return self.start('tailscale-serve')

    def status(self):
        return json.loads((self.work / 'tailscale-status.json').read_text())

    def test_healthy_tailscale_checks_once_per_minute_and_recovers_drift(self):
        controller = self.tailscale()
        self.assertEqual(controller.tick(False), 60)
        self.ts_calls.write_text('')
        node_before = self.count(self.node_calls)
        self.assertEqual(controller.tick(), 60)
        calls = self.ts_calls.read_text().splitlines()
        self.assertEqual(calls.count('serve status --json'), 1)
        self.assertEqual(self.count(self.node_calls) - node_before, 3)
        self.assertEqual(self.status()['serve_state'], 'active')
        self.assertTrue(self.status()['https_ready'])
        state = json.loads(self.ts_state.read_text()) | {'safe': False}
        self.ts_state.write_text(json.dumps(state))
        self.ts_calls.write_text('')
        self.assertEqual(controller.tick(), 60)
        self.assertEqual(self.ts_calls.read_text().splitlines().count('serve status --json'), 2)
        self.assertTrue(self.status()['https_ready'])

    def test_login_and_https_failures_keep_fast_retries(self):
        controller = self.tailscale(backend='NeedsLogin')
        self.assertEqual(controller.tick(False), 10)
        self.assertEqual(self.status()['serve_state'], 'waiting_for_login')
        self.ts_state.write_text(json.dumps(dict(backend='Running', safe=False, repair=False, funnel=False)))
        self.assertEqual(controller.tick(), 10)
        self.assertEqual(self.status()['serve_state'], 'waiting_for_https')
        self.assertFalse(self.status()['https_ready'])
        self.ts_state.write_text(json.dumps(dict(backend='Running', safe=False, repair=True, funnel=False)))
        self.assertEqual(controller.tick(), 60)
        self.assertTrue(self.status()['https_ready'])

    def test_unsafe_funnel_is_not_reported_as_healthy(self):
        controller = self.tailscale(funnel=True)
        self.assertEqual(controller.tick(False), 10)
        self.assertEqual(self.status()['serve_state'], 'error')
        self.assertFalse(self.status()['https_ready'])

    def test_unresponsive_status_calls_are_bounded_and_controller_keeps_running(self):
        timeout = shutil.which('timeout')
        self.tool('timeout', f'''#!/bin/sh
[ "$1" = --signal=TERM ] && [ "$2" = --kill-after=2s ] && [ "$3" = 10s ] || exit 99
echo bounded >>"$TS_RUN_DIR/timeout.calls"
shift 3
exec "{timeout}" --signal=TERM --kill-after=0.1s 0.1s "$@"
''')
        controller = self.tailscale(stall_status=True)
        self.assertEqual(controller.tick(False), 10)
        self.assertEqual(self.status()['backend_state'], 'Unknown')
        self.assertEqual(self.status()['serve_state'], 'waiting_for_login')
        self.assertFalse(self.status()['https_ready'])
        self.assertEqual(controller.tick(), 10)
        self.assertIsNone(controller.process.poll())
        self.assertGreaterEqual(self.count(self.work / 'timeout.calls'), 3)


if __name__ == '__main__':
    unittest.main()
