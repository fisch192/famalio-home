# Famalio Home installieren (Deutsch)

Englische Anleitung: [README.md](../README.md)

> **Status: experimentell, Version 0.3.0.** Geprüft: Der amd64-Build läuft auf
> Home Assistant OS (Datenbank, Migrationen, Besitzer-Einrichtung, Kopplung,
> Kalender anlegen/lesen/ändern/löschen, gezielte HA-Lesezugriffe, Neustart,
> Cold-Backup). **Noch nicht geprüft:** der `aarch64`-Build, die Wiederherstellung
> eines Backups, Dauerlast und der komplette Ablauf (Tailscale-HTTPS,
> Reverse-Proxy, Ein-Klick-Verbindung) auf einer frischen Fremdinstallation.
> Der Linux-Installer wird bei jeder Änderung automatisch getestet (Ubuntu komplett,
> Erkennung auf Debian, Fedora, Rocky, Alma, openSUSE, Arch, Alpine); ein echtes
> Let's-Encrypt-Zertifikat und eine echte Tailscale-Anmeldung damit sind ungetestet.
> Behalte die normale Famalio-Synchronisierung bei; dies soll nicht deine einzige
> Kopie sein.

## 1. Voraussetzungen

- Home Assistant OS oder Supervised mit Add-on-Store (Einstellungen → Add-ons;
  in den neuesten Versionen heißen Add-ons „Apps“).
- Prozessor `amd64` (getestet) oder `aarch64` (Build ungetestet), ca. 1 GB freier
  Arbeitsspeicher und einige GB Speicher. Das Add-on wird beim Installieren
  **auf deinem Home Assistant gebaut**: Internet nötig, dauert einige Minuten.
- Die Famalio-App mit gekauftem **Famalio Home** (in der App:
  **Einstellungen → Famalio Home**).
- Ein HTTPS-Zugang für die Handys:
  - kostenloses [Tailscale](https://tailscale.com)-Konto (empfohlen) und die
    Tailscale-App auf jedem Handy, **oder**
  - ein vorhandener HTTPS-Reverse-Proxy mit öffentlichem Namen und öffentlich
    vertrauenswürdigem Zertifikat.

## 2. Add-on-Repository hinzufügen

Klicke auf den Button:

[![Repository zu meinem Home Assistant hinzufügen](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Ffisch192%2Ffamalio-home)

oder manuell:

1. **Einstellungen → Add-ons → Add-on-Store**.
2. Oben rechts **⋮ → Repositories**.
3. `https://github.com/fisch192/famalio-home` einfügen, **Hinzufügen**, **Schließen**.

## 3. Add-on installieren und starten

1. Im Add-on-Store ganz nach unten zu **Famalio Home** scrollen (Seite ggf. neu laden) und **Famalio** öffnen.
2. **Installieren** klicken und warten, bis der lokale Build fertig ist (einige Minuten).
3. **Beim Start ausführen** einschalten, dann **Starten**.
4. **Weboberfläche öffnen** oder in der Seitenleiste **Famalio** wählen. Fehlt der Eintrag: auf der Add-on-Seite **In Seitenleiste anzeigen** aktivieren.

## 4. HTTPS-Zugang wählen

Der Assistent auf der Famalio-Seite fragt danach, sobald die Datenbank bereit ist.

**Tailscale (empfohlen)**

1. **Tailscale** wählen und den Anmeldelink im Assistenten anklicken.
2. Bei Tailscale anmelden und das neue Gerät bestätigen (Standardname `famalio-home`).
3. Falls Tailscale danach fragt: **HTTPS-Zertifikate** für dein Tailnet aktivieren
   (Tailscale-Admin-Konsole → DNS → HTTPS Certificates).
4. Warten, bis der Assistent eine grüne Adresse wie `https://famalio-home.<dein-tailnet>.ts.net`
   anzeigt. Das ist deine **Serveradresse**.
5. Auf jedem Handy die Tailscale-App installieren und im selben Tailnet anmelden.

Es sind weder Portfreigaben am Router noch Funnel oder Subnetz-Routen nötig oder aktiv.

**Vorhandener HTTPS-Reverse-Proxy (fortgeschritten)**

1. **Reverse-Proxy** wählen und deine HTTPS-Adresse eintragen (z. B. `https://famalio.example.org`).
2. Den Upstream deines Proxys auf den im Assistenten angezeigten internen Hostnamen samt Port
   setzen (bei Repository-Installationen mit Hash-Präfix, etwa `xxxxxxxx-famalio-home:8787`;
   aus dem Assistenten kopieren).
3. Der Assistent prüft Zertifikat und Famalio-Instanz. Klartext-HTTP und selbstsignierte
   Zertifikate werden abgelehnt. Keinen Port am Host oder Router freigeben.

## 5. Famalio-App verbinden (Besitzer-Einrichtung)

1. In Home Assistant das Add-on öffnen, Reiter **Protokoll** (Log). Beim ersten Start wird ein
   einmaliger **Setup-Code** ausgegeben (30 Minuten gültig, nur einmal verwendbar). Ist er
   abgelaufen, das Add-on neu starten (nur solange noch kein Besitzer existiert).
2. In der Famalio-App: **Einstellungen → Famalio Home → Home-Server verbinden**
   (erscheint, sobald dein Home-Kauf freigeschaltet ist).
3. **HTTPS-Serveradresse** aus Schritt 4 eintragen und **Verbindung prüfen** tippen.
4. **Neue Home-Familie einrichten** aufklappen: **Dein Anzeigename**, **Familienname** und den
   **Server-Einrichtungscode** eingeben, dann **Home-Familie erstellen**.
5. Die App zeigt jetzt **einmalig einen Wiederherstellungscode**. Schreibe ihn auf und
   bewahre ihn sicher auf. Ohne gekoppeltes Gerät ist er der einzige Weg zurück zur
   Besitzer-Berechtigung.

## 6. Integration über HACS installieren

Du brauchst [HACS](https://hacs.xyz). Klicke:

[![Repository in HACS öffnen](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=fisch192&repository=famalio-home&category=integration)

dann **Herunterladen** und **Home Assistant neu starten** (Einstellungen → System → Ein/Aus-Symbol → Neu starten).

Ohne HACS: Ordner `custom_components/famalio` aus diesem Repository nach
`<config>/custom_components/famalio` auf dem Home Assistant kopieren (z. B. mit dem Add-on
*File editor* oder *Samba*) und neu starten.

## 7. Home Assistant mit Famalio verbinden (ein Klick)

1. In der Seitenleiste **Famalio** öffnen: **Einrichtung → Mit Famalio verbinden**. Es erscheint ein kurzer Code.
2. In der Famalio-App: **Einstellungen → Famalio Home → Home-Server verbinden → Home Assistant**.
   Unter **Verbindungsanfragen** die Anfrage mit genau diesem Code öffnen.
3. Kalender auswählen, Detailgrad (alle Details oder nur *Beschäftigt*) und Zeitraum festlegen.
   Optional **Home Assistant darf bearbeiten** (nur mit vollen Details): dann darf Home
   Assistant einzelne Termine anlegen, ändern und löschen.
4. **Verbindung erlauben** tippen und einige Sekunden warten. Das Panel bestätigt die Integration selbst und wechselt zum Kalender.
   Die Kalender erscheinen auch unter Einstellungen → Geräte & Dienste → Famalio Home.

Es muss kein Token kopiert werden. Klappt der Button nicht, gibt es im Panel die manuelle
Token-Eingabe, oder du erzeugst in der App eine Integrationsfreigabe und trägst deren
`fhi_…`-Token unter Einstellungen → Geräte & Dienste → Integration hinzufügen → Famalio Home ein.

## 8. Weitere Handys koppeln

Auf dem Besitzer-Handy: **Einstellungen → Famalio Home → Home-Server verbinden → Gerätecode erstellen**
(einmal verwendbar) und den Code weitergeben. Auf dem zweiten Handy (Tailscale aktiv, falls genutzt):
denselben Bildschirm öffnen, Serveradresse eintragen, **Verbindung prüfen**, dann unter
**Bestehender Home-Familie beitreten** Anzeigename und **Gerätecode** eingeben und **Verbindung anfragen**.
Auf dem Besitzer-Handy die Geräteanfrage mit **Bearbeiten erlauben** bestätigen, danach auf dem zweiten
Handy **Freigabe prüfen**.

## 9. Alltag

**Kalender.** Das Famalio-Panel zeigt Monats-, Wochen-, Tages- und Agenda-Ansicht. Mit
Bearbeitungsrecht: **Neuer Termin** (oder Doppelklick auf einen Zeitslot), **Bearbeiten**,
**Löschen**. Wiederkehrende und importierte Termine bleiben nur in der App änderbar.

**Automationen.** Termin wählen → **＋ Automation**. Geltungsbereich (dieser Termin, genauer Titel,
Titel enthält Stichwort, ganzer Kalender), Zeitpunkt (Start oder Ende mit Versatz) und eine oder mehrere
Home-Assistant-Aktionen (Szenen, Skripte, Lichter, Benachrichtigungen ...). Die Regeln laufen im
Zeitplaner von Home Assistant und erscheinen im Automationseditor. Speichern führt die Aktion nicht sofort aus.

**Backups.** Das Add-on nutzt Cold-Backups: Home Assistant stoppt es kurz, damit die Datenbank
konsistent ist. *Famalio* in die Backups aufnehmen und eine Kopie außerhalb des Geräts aufbewahren.
Ein Cold-Backup funktioniert; die **Wiederherstellung ist noch nicht geprüft** – bitte auf einer
separaten Testinstanz probieren, nie über die laufende Installation.

**Updates.** Auf der Add-on-Seite aktualisieren (es wird lokal neu gebaut). Datenbankänderungen laufen
automatisch und additiv; eine neuere Datenbank wird nie zurückgestuft, ein älteres Add-on über neuen
Daten ist kein Rollback. Die Integration in HACS aktualisieren und Home Assistant neu starten.

**Deinstallieren.** In der App die Freigabe widerrufen (Bildschirm **Home Assistant**), die Integration
entfernen (Einstellungen → Geräte & Dienste → Famalio Home → Löschen), in HACS entfernen und danach das
Add-on deinstallieren. Beim Deinstallieren werden die Add-on-Daten samt Datenbank gelöscht. Das Gerät in
der Tailscale-Admin-Konsole entfernen.

## Fehlersuche

| Problem | Lösung |
|---|---|
| Add-on nicht im Store | Repository-URL prüfen, Seite neu laden oder **⋮ → Nach Updates suchen**. |
| Build schlägt fehl | Home Assistant braucht Internet (Debian, Docker Hub, PostgreSQL-apt, npm). Add-on-**Protokoll** und Speicherplatz prüfen, erneut versuchen. |
| Kein Seitenleisteneintrag | **In Seitenleiste anzeigen** aktivieren. Die Seite ist nur für HA-Administratoren sichtbar. |
| Kein Setup-Code im Protokoll | Der Code erscheint nur, solange kein Besitzer existiert, und 30 Minuten lang. Add-on neu starten. Existiert schon ein Besitzer, mit einem Kopplungscode koppeln. |
| Tailscale-Link abgelaufen / keine grüne Adresse | Assistent neu öffnen, Tailscale-Schritt wiederholen, **HTTPS-Zertifikate** im Tailnet aktivieren. |
| App verbindet nicht | Adresse muss `https://…` sein und vom Handy erreichbar (läuft Tailscale auf dem Handy?). Klartext-HTTP und selbstsignierte Zertifikate werden abgelehnt. |
| „Zu viele Anfragen“ beim Koppeln | Hinter dem Proxy teilen sich alle dieselbe Quelladresse; eine Minute warten (Option `unauthenticated_rate_per_minute`). |
| „Mit Famalio verbinden“ wartet endlos | Code rechtzeitig in der App bestätigen; Integration installiert und Home Assistant neu gestartet? Unter Einstellungen → Geräte & Dienste einen erkannten Famalio-Eintrag bestätigen. |
| Kalender bleibt bei Einrichtung | Erkennung allein genügt nicht; das Panel wartet (Prüfung alle 15 s), bis HA eine Famalio-Kalender-Entität registriert hat. |
| Keine Bearbeiten-Schaltflächen | In der App muss Bearbeiten erlaubt sein und die Freigabe volle Details haben (nicht *Beschäftigt*). Wiederkehrende Termine nur in der App (HTTP 409). |
| Integration verlangt erneute Anmeldung | Freigabe widerrufen oder abgelaufen; mit **Mit Famalio verbinden** neu erzeugen. |

## Sicherheit und Datenschutz

- Deine Kalenderdaten bleiben auf deinem Gerät; auf diesem Weg gibt es keinen Famalio-Cloud-Endpunkt.
- PostgreSQL hat keinen Netzwerkzugang und kein Passwort (Unix-Socket, Peer-Authentifizierung).
- Das Add-on hat keine Host-Ports, kein Host-Netzwerk, keinen Docker- oder Core-API-Zugriff, keine Hardware- oder Ordnerfreigaben; AppArmor ist aktiv.
- Zugriff nur über HTTPS mit öffentlich vertrauenswürdigem Zertifikat; Tailscale Funnel wird nicht genutzt.
- Home Assistant erhält nur die vom Besitzer bestätigte Freigabe (Kalender, Detailgrad, Zeitraum, optional Bearbeiten), jederzeit in der App widerrufbar.
- Die Anmeldung als HA-Administrator gibt keine Famalio-Rolle; jede API-Anfrage braucht eine gekoppelte Geräte-Sitzung.
- Basis-Images sind per Tag statt Digest referenziert; SBOM und Signierung fehlen noch.

## Ohne Home Assistant: Linux-Server mit einem Befehl

Für einen Linux-Server, Mini-PC, Raspberry Pi 4/5 (64-Bit-System), NAS oder VPS. Home Assistant
wird nicht gebraucht. Unterstützt: Debian 11/12, Ubuntu 20.04/22.04/24.04, Raspberry Pi OS
(64-Bit), Fedora, RHEL/Rocky/AlmaLinux 8/9, CentOS Stream, openSUSE Leap/Tumbleweed,
Arch/Manjaro und Alpine (ohne Gewähr); Prozessor `x86_64` oder `aarch64`. 32-Bit-ARM wird nicht
unterstützt. Etwa 1 GB freier Arbeitsspeicher und einige GB Speicher.

### 1. Installer starten

Auf dem Server (z. B. per `ssh`) ausführen:

```sh
curl -fsSL https://raw.githubusercontent.com/fisch192/famalio-home/main/install.sh | sudo bash
```

Der Installer installiert bei Bedarf Docker und Docker Compose, lädt Famalio Home nach
`/opt/famalio-home`, erzeugt zufällige Datenbankpasswörter (werden nie angezeigt), startet alles
und fragt:

1. **Wie die Handys den Server erreichen**: `tailscale` (empfohlen), `domain` oder `local` (siehe unten).
2. Je nach Wahl den **Tailscale-Auth-Key** oder **Domain und E-Mail-Adresse**.
3. Ob eine **tägliche Sicherung** eingerichtet werden soll (empfohlen).

Am Ende zeigt er die **Serveradresse** und den einmaligen **Setup-Code** (30 Minuten gültig).
Weiter mit Schritt 5 oben ab Punkt 2 (App: **Einstellungen → Famalio Home → Home-Server verbinden**,
Adresse eintragen, **Verbindung prüfen**, **Neue Home-Familie einrichten**, **Home-Familie erstellen**,
Wiederherstellungscode aufschreiben) und für weitere Handys mit Schritt 8.

Skript lieber vorher lesen: `curl -fsSLO https://raw.githubusercontent.com/fisch192/famalio-home/main/install.sh`,
`less install.sh`, dann `sudo bash install.sh`.

Optionen (alle Fragen lassen sich auch so beantworten):

| Option | Bedeutung |
|---|---|
| `--dir PFAD` | Installationsordner (Standard `/opt/famalio-home`) |
| `--mode tailscale\|domain\|local` | HTTPS-Zugang für die Handys |
| `--domain NAME`, `--email ADRESSE` | Domain und Let's-Encrypt-E-Mail für `--mode domain` |
| `--ts-authkey KEY` | Tailscale-Auth-Key (`tskey-...`), alternativ Variable `FAMALIO_TS_AUTHKEY` |
| `--no-backup` | Keine tägliche Sicherung einrichten |
| `--non-interactive` | Nichts fragen; fehlt etwas, abbrechen |
| `--update` | Neue Version laden und neu bauen; Daten, Passwörter, Einstellungen bleiben |
| `--uninstall` | Container entfernen; fragt, bevor Daten gelöscht werden |
| `--purge` | Mit `--uninstall`: auch Datenbank, Passwörter und Sicherungen löschen |
| `--check-only` | Nur Betriebssystem, CPU, Paketmanager und Docker anzeigen |

Den Installer erneut auszuführen ist gefahrlos; Passwörter und Datenbank bleiben erhalten.

### 2. HTTPS-Zugang: welche Variante?

Die App verbindet sich nur mit einer `https://`-Adresse mit vertrauenswürdigem Zertifikat.

- **Tailscale (empfohlen, nichts wird ins Internet geöffnet):** kostenloses Tailscale-Konto anlegen,
  in der Admin-Konsole (DNS-Seite) **MagicDNS** und **HTTPS Certificates** aktivieren, unter
  *Settings → Keys* einen **Auth-Key** erzeugen und dem Installer geben. Die Adresse lautet dann
  `https://famalio-home.<dein-tailnet>.ts.net`. Auf jedem Handy die Tailscale-App mit demselben
  Konto anmelden.
- **Eigene Domain (öffentliches HTTPS mit Let's Encrypt):** DNS-Eintrag (A/AAAA), z. B.
  `kalender.example.com`, auf die öffentliche IP des Servers; TCP-Ports **80 und 443** aus dem
  Internet erreichbar (Portweiterleitung, Firewall). Der Installer richtet Caddy ein, das das
  Zertifikat automatisch holt und erneuert. Adresse: `https://kalender.example.com`.
- **Lokal (eigener Reverse-Proxy):** Die API lauscht nur auf `http://127.0.0.1:8787`. Deinen
  vorhandenen Proxy (nginx, Traefik, NAS, Cloudflare Tunnel …) dorthin zeigen lassen und dessen
  `https://`-Adresse in der App verwenden. Selbstsignierte Zertifikate werden abgelehnt.

### 3. Sicherung, Wiederherstellung, Update, Deinstallation

Alle `docker compose`-Befehle im Ordner `/opt/famalio-home/app/standalone` ausführen.

Die tägliche Sicherung (systemd-Timer oder cron) schreibt nach `/opt/famalio-home/backups/`
und behält 14 Tage. Von Hand: `sudo /opt/famalio-home/backup.sh`. Sicherungen regelmäßig auf
ein anderes Gerät kopieren.

Wiederherstellen (ersetzt die aktuellen Kalenderdaten; bisher nur mit einer frisch installierten
Datenbank automatisch getestet, daher zuerst auf einem Testgerät ausprobieren):

```sh
cd /opt/famalio-home/app/standalone
sudo docker compose stop famalio-server
sudo sh -c 'docker compose exec -T -u postgres postgres \
  pg_restore --clean --if-exists --single-transaction --exit-on-error -d famalio \
  < /opt/famalio-home/backups/famalio-JJJJMMTT-HHMMSS.dump'
sudo docker compose start famalio-server
```

Update: `sudo bash /opt/famalio-home/install.sh --update` (macht vorher eine Sicherung).
Deinstallieren: `sudo bash /opt/famalio-home/install.sh --uninstall` (Daten bleiben) bzw.
zusätzlich `--purge` (löscht alles unwiderruflich). Bei Tailscale das Gerät auch in der
Admin-Konsole entfernen.

Kein Setup-Code mehr sichtbar (abgelaufen, solange noch kein Besitzer existiert):

```sh
cd /opt/famalio-home/app/standalone
sudo docker compose restart famalio-server
sudo docker compose logs famalio-server | grep -A1 "owner setup code"
```

Fehlersuche: `sudo docker compose ps` und `sudo docker compose logs --tail 100`
(bei Domain-Problemen `logs caddy`, bei Tailscale `logs tailscale`). Ausführlich in der
englischen Anleitung, Abschnitt *Troubleshooting (Linux)*.

### Manuell mit Docker Compose

```sh
git clone https://github.com/fisch192/famalio-home.git
cd famalio-home/standalone
./make-secrets.sh                  # erzeugt drei zufällige Datenbankpasswörter in secrets/
docker compose up -d --build       # postgres -> migrate -> server (erster Build dauert)
docker compose logs famalio-server # zeigt den einmaligen Setup-Code (30 Minuten)
curl http://127.0.0.1:8787/health/live
```

HTTPS danach mit `docker compose --profile tailscale up -d` (Auth-Key als `secrets/ts_authkey`),
`FAMALIO_DOMAIN=… FAMALIO_ACME_EMAIL=… docker compose --profile domain up -d` oder einem eigenen
Reverse-Proxy auf `http://127.0.0.1:8787`.

## Lizenz

Alle Rechte vorbehalten, sofern nicht anders angegeben.
