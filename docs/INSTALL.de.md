# Famalio Home installieren (Deutsch)

Englische Anleitung: [README.md](../README.md)

**Famalio Home** ist ein kleiner Server, der den Famalio-Familienkalender **bei dir zu Hause** speichert,
auf einem Gerät, das dir gehört, statt in der Famalio-Cloud. Du installierst ihn einmal; danach
synchronisieren die Famalio-Apps deiner Familie mit ihm. Mit Home Assistant erscheinen deine Kalender
auch dort und können Automationen auslösen.

**Du brauchst**

- Die **Famalio-App** (iPhone oder Android) mit gekauftem **Famalio Home** (in der App:
  **Einstellungen → Famalio Home**).
- **Einen Ort für den Server**: ein **Home-Assistant-OS-Gerät** (am einfachsten) **oder** einen
  **Linux-Rechner** (Mini-PC, Raspberry Pi 4/5 mit 64-Bit-System, NAS oder gemieteter Server).
- Etwa 20 Minuten und ein kostenloses [Tailscale](https://tailscale.com)-Konto (ein privater, sicherer
  Weg vom Handy zum Server; die Einrichtung führt dich hindurch).

## Welcher Weg ist meiner?

| Du hast … | Dann … | Dauer |
|---|---|---|
| Home Assistant OS (Raspberry Pi, Mini-PC, Home Assistant Green/Yellow, VM) | [Installation auf Home Assistant](#installation-auf-home-assistant) | ca. 15 Minuten |
| Einen Linux-Rechner ohne Home Assistant | [Ohne Home Assistant](#ohne-home-assistant-linux-server-mit-einem-befehl) (ein Befehl) | ca. 15 Minuten |
| Eine ältere Test-Installation (lokales Add-on 0.2.0) | [Umzug von einer älteren Installation](#umzug-von-einer-älteren-lokalen-add-on-installation) | ca. 10 Minuten |

> **Status: experimentell, Version 0.4.0.** Geprüft: Der amd64-Build läuft auf Home Assistant OS
> (Datenbank, Migrationen, Besitzer-Einrichtung, Kopplung, Kalender anlegen/lesen/ändern/löschen,
> gezielte HA-Lesezugriffe, Neustart, Cold-Backup). Der Linux-Installer wird bei jeder Änderung
> automatisch getestet. **Auf echter Hardware noch nicht geprüft:** die neue automatische
> Installation der Integration und der Neustart-Knopf aus Version 0.4.0, der `aarch64`-Build, die
> Wiederherstellung eines Home-Assistant-Backups und eine echte Tailscale-Anmeldung mit dem Installer.
> Behalte die normale Famalio-Synchronisierung bei; dies soll nicht deine einzige Kopie sein.

## Installation auf Home Assistant

Das Add-on erledigt das Schwierige selbst: Es richtet die Datenbank ein, installiert die
Home-Assistant-Integration und führt dich in einer eigenen Seite, dem **Famalio-Panel**, in drei Schritten
durch die Einrichtung. In den neuesten Home-Assistant-Versionen heißen Add-ons „Apps“; die Schritte sind
gleich.

Voraussetzungen: Home Assistant OS oder Supervised mit Add-on-Store (`amd64` getestet, `aarch64`
ungetestet), ca. 1 GB freier Arbeitsspeicher, einige GB Speicher und Internet (das Add-on wird beim
ersten Mal auf deinem Home Assistant gebaut, das dauert einige Minuten).

### Was kommt woher (bitte zuerst lesen)

Famalio Home besteht aus **zwei Teilen**, die an **zwei verschiedenen Orten** installiert werden:

| Teil | Aufgabe | Wo du ihn installierst |
|---|---|---|
| **Famalio-App (Server)** | Server, Datenbank und der Eintrag **Famalio** in der Seitenleiste | Im **App-Store / Add-on-Store** von Home Assistant. Dieses GitHub-Repository dort einmal hinzufügen (Schritt 1). **HACS kann diesen Teil nicht installieren.** |
| **Famalio-Integration** | Zeigt deine Famalio-Kalender in Home Assistant | Wird von der App **automatisch** installiert. HACS ist **nicht nötig**. (HACS kann dieselbe Integration installieren, bringt aber allein weder Server noch Seitenleisten-Eintrag.) |

Die Reihenfolge ist also immer: **Repository zum App-Store hinzufügen, App installieren, starten.**
Integration und Seitenleisten-Eintrag erscheinen danach von selbst.

### Schritt 1. Repository zum App-Store hinzufügen (nicht zu HACS)

Klicke auf den Button (er öffnet deinen Home Assistant):

[![Repository zu meinem Home Assistant hinzufügen](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Ffisch192%2Ffamalio-home)

und bestätige mit **Hinzufügen**. Oder von Hand: **Einstellungen → Add-ons → Add-on-Store**, oben rechts
**⋮ → Repositories**, `https://github.com/fisch192/famalio-home` einfügen, **Hinzufügen**, **Schließen**.

*Du siehst jetzt* das Repository **Famalio Home** in der Liste. Öffne **⋮ → Nach Updates suchen** (oder lade die
Seite neu); unten im Store erscheint ein Bereich **Famalio Home** mit der App **Famalio**.

### Schritt 2. Installieren und starten

1. **Famalio** öffnen und **Installieren** klicken. Warten, bis der Bau fertig ist (einige Minuten).
2. **Beim Booten starten** und **In Seitenleiste anzeigen** einschalten, dann **Starten**.

*Du siehst jetzt* das laufende Add-on (grüner **Stoppen**-Knopf) und **Famalio** in der linken Seitenleiste.

### Schritt 3. Famalio-Panel öffnen und Zugang einrichten

1. In der Seitenleiste auf **Famalio** klicken. Die Seite zeigt **Schritt 1 von 3 – Zugang einrichten**.
2. Auf den großen Knopf **Zugang einrichten** klicken. Es erscheint **Bei Tailscale anmelden**.
3. Anklicken, bei Tailscale anmelden (ein kostenloses Konto genügt) und das neue Gerät bestätigen.
   Dann zurück zur Famalio-Seite.
4. Zeigt das Panel **HTTPS in Tailscale aktivieren**, anklicken, auf der Tailscale-Seite
   **HTTPS Certificates** (DNS-Seite) einschalten und zurückkehren.

*Du siehst jetzt* ein grünes Feld **Schritt 1: Zugang einrichten** mit einer Adresse wie
`https://famalio-home.<dein-tailnet>.ts.net`. Das ist deine **Serveradresse**; das Panel geht von selbst
weiter. Es werden keine Router-Ports geöffnet.

Eigene Domain oder Reverse-Proxy statt Tailscale? In Schritt 1 **Erweitert: eigene HTTPS-Adresse
verwenden** öffnen (Details unten bei Linux: „HTTPS-Zugang: welche Variante?“).

### Schritt 4. Home Assistant neu starten, wenn das Panel fragt

Das Add-on hat die Famalio-Integration in den Konfigurationsordner von Home Assistant kopiert (HACS ist
nicht nötig). Home Assistant muss einmal neu starten, um sie zu laden. Das Panel zeigt **Home Assistant
muss einmal neu starten** mit einem Knopf.

1. **Home Assistant neu starten** klicken.
2. Ein bis zwei Minuten warten, die Seite nicht schließen.

*Du siehst jetzt*, dass das Panel von selbst zurückkommt und mit **Schritt 2 von 3 – Famalio-App
verbinden** weitermacht. (Hast du Home Assistant schon selbst neu gestartet: **Ich habe Home Assistant
schon neu gestartet** klicken.)

### Schritt 5. Famalio-App verbinden (QR-Code scannen)

Schritt 2 zeigt deine **Serveradresse**, den einmaligen **Einrichtungscode** mit **Kopieren**-Knöpfen und
einen **QR-Code**. Der Code gilt einmal und 24 Stunden; das Add-on-Protokoll brauchst du nicht. Auf dem
Handy (Tailscale läuft auf dem Handy):

1. Famalio-App öffnen: **Einstellungen → Famalio Home → Home-Server verbinden**.
2. **Einrichtungscode scannen** tippen und die Kamera auf den QR-Code im Famalio-Panel halten. (Ohne
   Scannen: Adresse eintragen, **Verbindung prüfen** tippen und den Code abtippen.)
3. **Neue Home-Familie einrichten** aufklappen, **Dein Anzeigename** und **Familienname** eingeben und
   **Home-Familie erstellen** tippen.
4. Die App zeigt **einmalig** einen **Wiederherstellungscode**. Gut aufschreiben und sicher aufbewahren;
   ohne gekoppeltes Gerät ist er der einzige Weg, die Besitzer-Rechte zurückzuholen.

*Du siehst jetzt* in der App deine neue Home-Familie, und im Famalio-Panel wird **Schritt 2: Famalio-App
verbinden** von selbst grün (der Code verschwindet).

### Schritt 6. Home Assistant mit Famalio verbinden

Schritt 3 zeigt den Knopf **Mit Famalio verbinden**.

1. **Mit Famalio verbinden** klicken. Ein großer Code wie `ABCD-EFGH` erscheint.
2. In der App: **Einstellungen → Famalio Home → Home-Server verbinden → Verbindungsanfragen** und die
   Anfrage mit genau diesem Code öffnen.
3. Wähle, welche Kalender Home Assistant sehen darf und ob volle Details oder nur belegte Zeiten.
   Optional: **Home Assistant darf bearbeiten** erlaubt Home Assistant, einzelne Termine anzulegen,
   zu ändern und zu löschen (braucht volle Details).
4. **Verbindung erlauben** tippen.

*Du siehst jetzt* im Panel **Verbunden ✓**, danach öffnet sich der Kalender. Deine Kalender erscheinen
auch unter **Einstellungen → Geräte & Dienste → Famalio Home**. Wartet eine Anfrage auf Bestätigung, wird
der Code auch oben auf der Kalenderseite gezeigt. Es muss kein Token kopiert werden; die manuelle
Token-Variante unter **Erweitert** in Schritt 3 ist nur ein Notweg.

### Weitere Handys koppeln

Auf dem Besitzer-Handy: **Einstellungen → Famalio Home → Home-Server verbinden → Gerätecode erstellen**
(einmal verwendbar) und den Code weitergeben. Auf dem zweiten Handy (Tailscale aktiv): denselben
Bildschirm öffnen, Serveradresse eintragen, **Verbindung prüfen**, dann unter **Bestehender Home-Familie
beitreten** Anzeigename und **Gerätecode** eingeben und **Verbindung anfragen**. Auf dem Besitzer-Handy die
Geräteanfrage mit **Bearbeiten erlauben** bestätigen, danach auf dem zweiten Handy **Freigabe prüfen**.

*Du siehst jetzt* auf beiden Handys denselben Kalender.

### Alltag

**Kalender.** Das Famalio-Panel zeigt Monats-, Wochen-, Tages- und Agenda-Ansicht. Mit
Bearbeitungsrecht: **Neuer Termin** (oder Doppelklick auf einen Zeitslot), **Bearbeiten**, **Löschen**.
Wiederkehrende und importierte Termine bleiben nur in der App änderbar.

**Automationen.** Termin wählen → **＋ Automation**. Geltungsbereich (dieser Termin, genauer Titel, Titel
enthält Stichwort, ganzer Kalender), Zeitpunkt (Start oder Ende mit Versatz) und eine oder mehrere
Home-Assistant-Aktionen (Szenen, Skripte, Lichter, Benachrichtigungen ...). Die Regeln laufen im Zeitplaner
von Home Assistant und erscheinen im Automationseditor. Speichern führt die Aktion nicht sofort aus.

### Sicherungen und Wiederherstellung

Das Add-on nutzt Cold-Backups: Home Assistant stoppt es kurz, damit die Datenbank konsistent ist.
*Famalio* in die Home-Assistant-Backups aufnehmen und eine Kopie außerhalb des Geräts aufbewahren. Ein
Backup funktioniert; die **Wiederherstellung ist noch nicht geprüft** – auf einer separaten Testinstanz
probieren, nie über die laufende Installation.

### Updates

Auf der Add-on-Seite **Aktualisieren** (es wird neu gebaut). Beim nächsten Start aktualisiert das Add-on
auch die mitgelieferte Integration; starte Home Assistant neu, wenn das Panel fragt. Datenbankänderungen
laufen automatisch und additiv; eine neuere Datenbank wird nie zurückgestuft, ein älteres Add-on über neuen
Daten ist kein Rollback. Eine neuere Integration, die du selbst installiert hast (z. B. über HACS), wird nie
überschrieben.

### Deinstallieren

In der App die Freigabe widerrufen (Bildschirm **Home Assistant**), die Integration entfernen
(**Einstellungen → Geräte & Dienste → Famalio Home → Löschen**), dann das Add-on deinstallieren. Dabei
werden die Add-on-Daten samt Datenbank gelöscht. Das Gerät in der Tailscale-Admin-Konsole entfernen. Der
Ordner `custom_components/famalio` im Home-Assistant-Konfigurationsordner bleibt; lösche ihn, wenn du ihn
nicht mehr willst.

### Zu HACS

HACS ist **optional und nicht mehr nötig**: Das Add-on installiert und aktualisiert die Integration selbst.
Hast du sie früher über HACS installiert, verlasse dich nicht darauf: in HACS entfernen (den Integrations-
Eintrag in Home Assistant behalten) und das Add-on die Dateien verwalten lassen. Fortgeschrittene können
`custom_components/famalio` weiterhin über HACS installieren; das Add-on ersetzt keine Kopie mit gleicher
oder höherer Version.

### Umzug von einer älteren lokalen Add-on-Installation

Hast du eine frühere Version als *lokales* Add-on (`local_famalio_home`, Version 0.2.0) getestet, wechsle so
zur Repository-Version. **Eine frische Installation startet mit leerer Datenbank**; die Familiendaten der
alten Installation werden nicht übernommen, was für eine Test-Installation in Ordnung ist. Beide Add-ons
nie gleichzeitig betreiben.

1. In der Famalio-App: **Einstellungen → Famalio Home → Home-Server verbinden → Trennen**.
2. In Home Assistant den alten Integrations-Eintrag entfernen: **Einstellungen → Geräte & Dienste →
   Famalio Home → ⋮ → Löschen**.
3. **Einstellungen → Add-ons → Famalio (lokal) → Deinstallieren**. Den Ordner `addons/famalio_home`
   löschen, falls du ihn für das lokale Add-on angelegt hattest.
4. In der Tailscale-Admin-Konsole das alte Gerät `famalio-home` entfernen (damit das neue denselben Namen bekommt).
5. Ab Schritt 1 dieser Anleitung neu installieren; in der App eine neue Home-Familie einrichten (Schritt 5)
   und Home Assistant verbinden (Schritt 6).

### Fehlersuche (Home Assistant)

| Problem | Lösung |
|---|---|
| Add-on nicht im Store | Repository-URL prüfen, Seite neu laden oder **⋮ → Nach Updates suchen**. |
| Build schlägt fehl | Home Assistant braucht Internet (Debian, Docker Hub, PostgreSQL-apt, npm). Add-on-**Protokoll** und Speicherplatz prüfen, erneut versuchen. |
| Kein Seitenleisteneintrag | **In Seitenleiste anzeigen** aktivieren. Die Seite ist nur für HA-Administratoren sichtbar. |
| Panel verlangt den Neustart, aber nichts passiert | Einmal **Home Assistant neu starten** klicken und zwei Minuten warten. Schon neu gestartet? **Ich habe Home Assistant schon neu gestartet** klicken. Im Add-on-**Protokoll** nach „Home Assistant integration installed“ suchen. |
| Kein QR-Code / Einrichtungscode in Schritt 2 | Der Code erscheint nur, solange kein Besitzer existiert, und 24 Stunden lang. Ist er abgelaufen, das Add-on neu starten (Add-on-Seite → **Neustart**). Existiert schon ein Besitzer, mit einem Gerätecode koppeln. |
| Tailscale-Link abgelaufen / keine grüne Adresse | Panel neu laden und **Erneut prüfen** klicken. **HTTPS Certificates** im Tailnet aktivieren. |
| App verbindet nicht | Adresse muss `https://…` sein und vom Handy erreichbar (läuft Tailscale auf dem Handy?). Klartext-HTTP und selbstsignierte Zertifikate werden abgelehnt. |
| „Mit Famalio verbinden“ wartet endlos | Code rechtzeitig in der App bestätigen; Home Assistant nach Schritt 4 neu gestartet? Unter Einstellungen → Geräte & Dienste einen erkannten Famalio-Eintrag bestätigen. |
| Kalender bleibt bei der Einrichtung | Das Panel wartet (Prüfung alle 15 s), bis HA eine Famalio-Kalender-Entität registriert hat. |
| Keine Bearbeiten-Schaltflächen | In der App muss Bearbeiten erlaubt sein und die Freigabe volle Details haben (nicht nur belegte Zeiten). Wiederkehrende Termine nur in der App. |
| Integration verlangt erneute Anmeldung | Freigabe widerrufen oder abgelaufen; mit **Mit Famalio verbinden** neu erzeugen. |
| „Zu viele Anfragen“ beim Koppeln | Eine Minute warten und erneut versuchen. |

### Sicherheit und Datenschutz

- Deine Kalenderdaten bleiben auf deinem Gerät; auf diesem Weg gibt es keinen Famalio-Cloud-Endpunkt.
- PostgreSQL hat keinen Netzwerkzugang und kein Passwort (Unix-Socket, Peer-Authentifizierung).
- Das Add-on hat keine Host-Ports, kein Host-Netzwerk, keinen Docker- oder Core-API-Zugriff und keinen
  Hardwarezugriff; AppArmor ist aktiv.
- **Genau eine Ordnerfreigabe, mit Absicht:** Das Add-on darf in den Konfigurationsordner von Home Assistant
  schreiben (`map: homeassistant_config`, lesen und schreiben). Es nutzt das nur, um seine eigene Integration
  nach `custom_components/famalio` zu kopieren, wenn sie fehlt oder älter ist, und überschreibt nie eine
  neuere Kopie. Sonst wird in diesem Ordner nichts gelesen, aufgelistet oder verändert.
- Der einmalige Einrichtungscode geht über eine private Datei vom Server zum Panel; er wird nur angemeldeten
  Home-Assistant-Administratoren gezeigt und nie über die API oder das Relay gesendet.
- Zugriff nur über HTTPS mit öffentlich vertrauenswürdigem Zertifikat; Tailscale Funnel wird nicht genutzt.
- Home Assistant erhält nur die vom Besitzer bestätigte Freigabe, jederzeit in der App widerrufbar.
- Basis-Images sind per Tag statt Digest referenziert; SBOM und Signierung fehlen noch.

## Häufige Fragen

**Was kostet das?** Die Server-Software ist kostenlos. Du brauchst die Famalio-App und den Kauf **Famalio
Home** in der App. Der kostenlose Tailscale-Tarif genügt für eine Familie; Domain (nur für `domain`) und
Hardware sind deine eigenen Kosten.

**Funktioniert es offline?** Die Handys halten den Kalender auf dem Gerät und synchronisieren, sobald sie den
Server wieder erreichen. Unterwegs brauchen sie die HTTPS-Verbindung (z. B. Tailscale auf dem Handy).

**Was, wenn die Famalio-Cloud verschwindet?** Dein Home-Server nutzt sie nicht. Die Daten liegen in deiner
eigenen Datenbank und in den Apps auf den Handys. Sichere den Server regelmäßig; die Famalio-App muss auf den
Handys installiert bleiben.

**Wo sind meine Daten?** Nur auf deinem Gerät (Datenbank im Add-on bzw. im Docker-Volume), nicht bei Famalio.

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

Am Ende zeigt er die **Serveradresse** und den einmaligen **Server-Einrichtungscode** (30 Minuten
gültig). Ist das Programm `qrencode` auf dem Server installiert (`sudo apt install qrencode`), erscheint
zusätzlich ein **QR-Code** im Terminal. Dann in der App:

1. **Einstellungen → Famalio Home → Home-Server verbinden**.
2. **Einrichtungscode scannen** tippen und die Kamera auf den QR-Code halten (Adresse und Code werden
   eingetragen). Ohne QR-Code: Adresse eintragen und **Verbindung prüfen** tippen.
3. **Neue Home-Familie einrichten** aufklappen, Anzeigename und Familienname eingeben (und, falls nicht
   gescannt, den Server-Einrichtungscode), dann **Home-Familie erstellen**.
4. Den **Wiederherstellungscode** aufschreiben: Er wird nur einmal angezeigt.

Weitere Handys koppelst du wie [oben beschrieben](#weitere-handys-koppeln).

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
