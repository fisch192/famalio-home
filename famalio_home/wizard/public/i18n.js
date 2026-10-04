// English for the Famalio panel. German is the source language of the page and of
// every script; this file maps each German text to English and keeps the page in
// sync, including texts the scripts insert later. The language follows the
// browser; "EN | DE" in the header overrides it and is remembered.
//
// Texts that are not in the dictionary stay German, so a missing entry never
// breaks the page. `test/i18n.test.mjs` checks the dictionary and the patterns.

export const EN = {
  // ---- header / navigation
  "Famalio Kalender": "Famalio calendar",
  "Hauptnavigation": "Main navigation",
  "Kalender": "Calendar",
  "Einrichtung": "Setup",
  "HA-Automationen": "HA automations",
  "Familienkalender": "Family calendar",
  "Fortschritt": "Progress",
  // ---- setup wizard: headings and steps
  "SCHRITT 1 VON 3": "STEP 1 OF 3",
  "SCHRITT 2 VON 3": "STEP 2 OF 3",
  "SCHRITT 3 VON 3": "STEP 3 OF 3",
  "Zugang einrichten": "Set up access",
  "Zugang": "Access",
  "Famalio-App": "Famalio app",
  "Home Assistant": "Home Assistant",
  "Famalio-App verbinden": "Connect the Famalio app",
  "Home Assistant verbinden": "Connect Home Assistant",
  "Wir prüfen, was schon erledigt ist …": "Checking what is already done …",
  "Verbindungsstatus wird geprüft …": "Checking the connection …",
  "Alles in Ordnung. Folge den Schritten unten.": "All good. Follow the steps below.",
  "Alles verbunden.": "Everything is connected.",
  "Alles verbunden ✓": "Everything is connected ✓",
  "Home Assistant wartet auf dich.": "Home Assistant is waiting for you.",
  "Öffne die Famalio-App: Einstellungen → Famalio Home → Home-Server verbinden → Verbindungsanfragen →": "Open the Famalio app: Settings → Famalio Home → Connect Home server → Connection requests →",
  "Verbindung erlauben": "Allow connection",
  ". Der Code muss gleich sein:": ". The code must match:",
  "Tippe auf „Home Assistant neu starten“.": "Tap “Restart Home Assistant”.",
  "Tippe auf „Bei Tailscale anmelden“ und melde dich an. Danach geht es hier von selbst weiter.": "Tap “Sign in to Tailscale” and sign in. This page then continues by itself.",
  "Bitte einen Moment warten. Der Zugang wird vorbereitet.": "Please wait a moment. Access is being prepared.",
  "Tippe auf „HTTPS in Tailscale aktivieren“. Danach geht es hier von selbst weiter.": "Tap “Enable HTTPS in Tailscale”. This page then continues by itself.",
  "Das hat nicht geklappt. Tippe auf „Erneut prüfen“.": "That did not work. Tap “Check again”.",
  "Bitte einen Moment warten. Der Zugang wird geprüft.": "Please wait a moment. Access is being checked.",
  "Tippe auf „Zugang einrichten“.": "Tap “Set up access”.",
  "Scanne den QR-Code mit der Famalio-App. Dieser Schritt wird von selbst grün.": "Scan the QR code with the Famalio app. This step turns green by itself.",
  "Der Einrichtungscode ist abgelaufen. Starte das Add-on neu (Technische Details).": "The setup code has expired. Restart the app (Technical details).",
  "Einen Moment, der Einrichtungscode wird geladen.": "One moment, the setup code is loading.",
  "Tippe in der Famalio-App auf „Verbindung erlauben“.": "In the Famalio app, tap “Allow connection”.",
  "Tippe auf „Mit Famalio verbinden“.": "Tap “Connect with Famalio”.",
  "Dein Familienkalender ist jetzt in Home Assistant. Tippe oben auf „Kalender“.": "Your family calendar is now in Home Assistant. Tap “Calendar” at the top.",
  "Datenbank noch nicht bereit": "Database not ready yet",
  "Tailscale wartet auf deine Anmeldung. Diese Seite prüft von selbst weiter.": "Tailscale is waiting for you to sign in. This page keeps checking by itself.",
  "Der sichere Zugang (HTTPS) wird vorbereitet …": "Secure access (HTTPS) is being prepared …",
  "Der Zugang funktioniert.": "Access works.",
  "Der Zugang wird geprüft …": "Access is being checked …",
  "Der Zugang hat nicht geklappt. Tippe auf „Erneut prüfen“.": "Access did not work. Tap “Check again”.",
  "Das geht gleich weiter, sobald Schritt 1 fertig ist.": "This continues as soon as step 1 is done.",
  "Verbinde jetzt die Famalio-App mit deinem Zuhause. Die einfachste Möglichkeit ist der QR-Code. Dieser Schritt wird von selbst grün, sobald die App verbunden ist.": "Now connect the Famalio app to your home. The easiest way is the QR code. This step turns green by itself as soon as the app is connected.",
  "Die Famalio-App ist mit deinem Zuhause verbunden. Weitere Handys verbindest du in der App mit einem Gerätecode (Einstellungen → Famalio Home → Home-Server verbinden → Gerätecode erstellen).": "The Famalio app is connected to your home. Connect more phones in the app with a device code (Settings → Famalio Home → Connect Home server → Create device code).",
  "Der Server meldet seinen Einrichtungsstatus nicht. Warte einen Moment oder öffne „Technische Details“ und aktualisiere den Status.": "The server is not reporting its setup status. Wait a moment, or open “Technical details” and refresh the status.",
  "Warte auf Bestätigung …": "Waiting for confirmation …",
  "Neue Anfrage senden": "Send a new request",
  "Schritt 3: Home Assistant ist verbunden": "Step 3: Home Assistant is connected",
  "Verbunden ✓": "Connected ✓",
  "Verbunden ✓ Der Kalender öffnet sich gleich.": "Connected ✓ The calendar opens in a moment.",
  "Die Verbindung wird in Home Assistant eingerichtet …": "The connection is being set up in Home Assistant …",
  "Home Assistant konnte die Verbindung nicht übernehmen. Öffne „Technische Details → Integration in Home Assistant verwalten“ und bestätige sie dort.": "Home Assistant could not take over the connection. Open “Technical details → Manage integration in Home Assistant” and confirm it there.",
  "Freigabe übernommen. Die Verbindung wird eingerichtet …": "Approval received. The connection is being set up …",
  "Warte auf Bestätigung in der App …": "Waiting for confirmation in the app …",
  "Die Verbindung hat nicht geklappt. Tippe auf „Neue Anfrage senden“.": "The connection did not work. Tap “Send a new request”.",
  "Bitte starte zuerst Home Assistant neu (Knopf oben).": "Please restart Home Assistant first (button above).",
  "Bitte warten. Dieses Fenster geht von selbst weiter, sobald Home Assistant wieder bereit ist.": "Please wait. This window continues by itself as soon as Home Assistant is ready again.",
  "Home Assistant startet neu …": "Home Assistant is restarting …",
  "Home-Assistant-Integration: Status unbekannt.": "Home Assistant integration: status unknown.",
  "✓ Die Famalio-App ist verbunden. Weitere Handys verbindest du in der App mit einem Gerätecode.": "✓ The Famalio app is connected. Connect more phones in the app with a device code.",
  "✓ Home Assistant ist verbunden. Dein Kalender ist fertig.": "✓ Home Assistant is connected. Your calendar is ready.",
  "Der Famalio-Server startet noch. Bitte einen Moment warten.": "The Famalio server is still starting. Please wait a moment.",
  "Status nicht erreichbar. Bitte prüfen Sie die Verbindung.": "Status not reachable. Please check the connection.",
  "Die Anfrage hat zu lange gedauert. Prüfen Sie den Status und versuchen Sie es erneut.": "The request took too long. Check the status and try again.",
  "Aktion fehlgeschlagen. Bitte versuchen Sie es erneut.": "Action failed. Please try again.",
  "HTTPS und Serveridentität werden geprüft.": "HTTPS and server identity are being checked.",
  "Netzwerkzugriff wird eingerichtet. Die HTTPS-Verbindung wird anschließend geprüft.": "Network access is being set up. The HTTPS connection is checked afterwards.",
  "Geben Sie eine HTTPS-Origin ohne Pfad, Zugangsdaten oder Query ein, zum Beispiel https://home.example.net.": "Enter an HTTPS address without path, credentials or query, for example https://home.example.net.",
  "Tailscale-Status wird erneut geprüft.": "Checking the Tailscale status again.",
  "Adresse kopiert.": "Address copied.",
  "Einrichtungscode kopiert.": "Setup code copied.",
  "Kopieren ist hier nicht möglich. Tippe die Adresse bitte von Hand in die App ein.": "Copying is not possible here. Please type the address into the app by hand.",
  "Kopieren ist hier nicht möglich. Tippe den Code bitte von Hand in die App ein.": "Copying is not possible here. Please type the code into the app by hand.",
  "Interner API-Upstream kopiert. Veröffentlichen Sie diesen Dienst nicht direkt im LAN oder Internet.": "Internal API upstream copied. Do not publish this service directly on the LAN or the internet.",
  "Kopieren nicht möglich. Verwenden Sie den angezeigten internen Upstream nur innerhalb des Home-Assistant-Netzes.": "Copying is not possible. Use the internal upstream shown only inside the Home Assistant network.",
  "Verbindungsanfrage gesendet. Bestätigen Sie den Code in der Famalio App.": "Connection request sent. Confirm the code in the Famalio app.",
  "Der Integrationstoken hat nicht das erwartete Format. Kopieren Sie den fhi_-Token aus der ausdrücklich bestätigten App-Freigabe.": "The integration token does not have the expected format. Copy the fhi_ token from the explicitly confirmed app approval.",
  "Home Assistant wird gebeten, die Integration zu entdecken.": "Home Assistant is being asked to discover the integration.",
  // ---- setup wizard: static HTML
  "Home Assistant muss einmal neu starten": "Home Assistant has to restart once",
  "Famalio hat seinen Teil für Home Assistant installiert. Damit er benutzt werden kann, muss Home Assistant neu starten. Das dauert etwa ein bis zwei Minuten. Danach geht es hier von selbst weiter.": "Famalio has installed its part for Home Assistant. For it to be used, Home Assistant has to restart. This takes about one to two minutes. This page then continues by itself.",
  "Home Assistant neu starten": "Restart Home Assistant",
  "Ich habe Home Assistant schon neu gestartet": "I already restarted Home Assistant",
  "Schritt 3: Home Assistant verbinden": "Step 3: Connect Home Assistant",
  "Schritt 1: Zugang einrichten": "Step 1: Set up access",
  "Damit dein Handy deinen Famalio-Server auch unterwegs sicher erreicht, brauchen wir einen privaten Zugang. Dafür nutzen wir Tailscale (kostenlos). Tippe einfach auf den Knopf.": "So that your phone can reach your Famalio server securely when you are away, we need a private connection. We use Tailscale for this (free). Just tap the button.",
  "Bei Tailscale anmelden": "Sign in to Tailscale",
  "Erneut prüfen": "Check again",
  "Wenn sich ein neues Fenster öffnet: Melde dich bei Tailscale an (ein Konto ist kostenlos) und komm danach hierher zurück. Diese Seite geht von selbst weiter.": "If a new window opens: sign in to Tailscale (an account is free) and then come back here. This page continues by itself.",
  "Erweitert: eigene HTTPS-Adresse verwenden": "Advanced: use my own HTTPS address",
  "Nur für Fortgeschrittene: Du betreibst schon eine Domain mit Reverse-Proxy und gültigem HTTPS-Zertifikat. Dann gib hier die Adresse ein. Sonst bleib bei „Zugang einrichten“.": "For advanced users only: you already run a domain with a reverse proxy and a valid HTTPS certificate. Enter the address here. Otherwise stay with “Set up access”.",
  "HTTPS-Adresse": "HTTPS address",
  "Diese Adresse verwenden": "Use this address",
  "Der Assistent richtet weder Router noch Reverse-Proxy ein. Leite den Proxy auf den unter „Technische Details“ gezeigten internen Upstream.": "The assistant sets up neither your router nor your reverse proxy. Point the proxy at the internal upstream shown under “Technical details”.",
  "Schritt 2: Famalio-App verbinden": "Step 2: Connect the Famalio app",
  "Warte auf Schritt 1.": "Waiting for step 1.",
  "ADRESSE DEINES SERVERS": "YOUR SERVER ADDRESS",
  "In der Famalio-App öffnen": "Open in the Famalio app",
  "Am Handy: Tippe auf den Knopf. Die App füllt Adresse und Code aus, du bestätigst mit „Home-Familie erstellen“.": "On your phone: tap the button. The app fills in the address and code, and you confirm with \"Create Home family\".",
  "Kopieren": "Copy",
  "EINRICHTUNGSCODE (EINMALIG GÜLTIG)": "SETUP CODE (VALID ONCE)",
  "Der Einrichtungscode ist abgelaufen. Starte das Famalio-Add-on unter „Technische Details → Add-on verwalten“ einmal neu, dann erscheint hier ein neuer Code.": "The setup code has expired. Restart the Famalio app once under “Technical details → Manage app”, and a new code appears here.",
  "QR-Code mit Serveradresse und Einrichtungscode": "QR code with server address and setup code",
  "Öffne die": "Open the",
  "auf deinem Handy.": "on your phone.",
  "Tippe auf": "Tap",
  "Einstellungen → Famalio Home → Home-Server verbinden": "Settings → Famalio Home → Connect Home server",
  "Einrichtungscode scannen": "Scan setup code",
  "und halte die Kamera auf den QR-Code. Oder tippe Adresse und Code von Hand ein.": "and point the camera at the QR code. Or type the address and code by hand.",
  "Home-Familie erstellen": "Create Home family",
  "und speichere den angezeigten Wiederherstellungscode gut.": "and keep the recovery code that is shown safe.",
  "Tippe auf den Knopf. Du bekommst einen Code, den du in der Famalio-App bestätigst. Mehr ist nicht nötig.": "Tap the button. You get a code that you confirm in the Famalio app. Nothing more is needed.",
  "Mit Famalio verbinden": "Connect with Famalio",
  "DEIN VERBINDUNGSCODE": "YOUR CONNECTION CODE",
  "Einstellungen → Famalio Home → Home-Server verbinden → Verbindungsanfragen": "Settings → Famalio Home → Connect Home server → Connection requests",
  "Prüfe, dass dort derselbe Code steht, und tippe auf": "Check that the same code is shown there, and tap",
  "Anfrage senden": "Send request",
  "In der App bestätigen": "Confirm in the app",
  "Verbunden": "Connected",
  "Erweitert: mit Integrationstoken verbinden": "Advanced: connect with an integration token",
  "Integrationstoken": "Integration token",
  "Verbinden": "Connect",
  "Der Token wird nur für diese Anfrage verwendet und danach aus dem Feld entfernt.": "The token is used for this request only and then removed from the field.",
  "Technische Details": "Technical details",
  "Reverse-Proxy-Upstream": "Reverse proxy upstream",
  "Wird nach Auswahl angezeigt": "Shown after you choose",
  "Upstream kopieren": "Copy upstream",
  "Der interne API-Upstream wird nach Auswahl von „Erweitert: eigene HTTPS-Adresse“ angezeigt. Veröffentliche Port 8787 nie direkt im LAN oder Internet.": "The internal API upstream is shown after you choose “Advanced: use my own HTTPS address”. Never publish port 8787 directly on the LAN or the internet.",
  "Add-on verwalten": "Manage app",
  "Integration in Home Assistant verwalten": "Manage integration in Home Assistant",
  "Datenbankstatus wird geprüft …": "Checking the database status …",
  "Status aktualisieren": "Refresh status",
  // ---- calendar workspace
  "Monat": "Month", "Woche": "Week", "Agenda": "Agenda", "Heute": "Today", "Zurück": "Back", "Weiter": "Next",
  "Aktualisieren": "Refresh", "Schließen": "Close", "Termin": "Event", "Titel": "Title", "Beginn": "Start", "Ende": "End",
  "Notiz": "Note", "Optional": "Optional", "Name": "Name", "Daten": "Data", "Ziel": "Target", "Aktion": "Action",
  "Stichwort": "Keyword", "Minuten": "Minutes", "Entfernen": "Remove", "Löschen": "Delete", "Bearbeiten": "Edit",
  "Aktiv": "Active", "Gespeichert": "Saved", "Nicht verfügbar": "Not available", "Beliebig": "Any",
  "Szene": "Scene", "Skript": "Script", "Licht": "Light", "Schalter": "Switch", "Thermostat": "Thermostat",
  "Licht an": "Light on", "Licht aus": "Light off", "Klima": "Climate", "Mitteilung": "Notification",
  "Ganztägig": "All day", "ganztägig": "all day", "Ganzer Kalender": "Whole calendar",
  "Zum Beginn": "At start", "Vor Beginn": "Before start", "Nach Beginn": "After start",
  "Zum Ende": "At end", "Vor Ende": "Before end", "Nach Ende": "After end",
  "Eigene Bedingung": "Custom condition", "Alle Termine": "All events", "Ein einzelner Termin": "A single event",
  "Nur dieser Termin": "Only this event", "Gleicher Titel": "Same title", "Titel enthält …": "Title contains …",
  "Automationen": "Automations", "Kalender-Automationen": "Calendar automations", "Neue Automation": "New automation",
  "Automation speichern": "Save automation", "Alle Regeln ansehen": "View all rules",
  "＋ Neuer Termin": "＋ New event", "Neuer Termin": "New event", "Termin bearbeiten": "Edit event",
  "Termin anlegen": "Create event", "Änderungen speichern": "Save changes", "Zurück zum Termin": "Back to the event",
  "Wird gespeichert …": "Saving …", "Speichern fehlgeschlagen.": "Saving failed.",
  "Termine werden geladen …": "Loading events …", "Verbinde mit Home Assistant …": "Connecting to Home Assistant …",
  "Wann?": "When?", "Was soll passieren?": "What should happen?", "Für welche Termine?": "For which events?",
  "Wird automatisch benannt": "Named automatically",
  "Noch kein Famalio Kalender": "No Famalio calendar yet",
  "Home Assistant konnte nicht erreicht werden.": "Home Assistant could not be reached.",
  "Verbindung nicht verfügbar": "Connection not available",
  "Bitte öffnen Sie diesen Kalender in einer angemeldeten Home Assistant Sitzung.": "Please open this calendar in a signed-in Home Assistant session.",
  "Einige Automationen konnten nicht gelesen werden. Die vollständige Liste finden Sie in Home Assistant.": "Some automations could not be read. You can find the full list in Home Assistant.",
  "Bearbeiten ist nicht aktiviert": "Editing is not enabled",
  "Einrichtung öffnen": "Open setup", "Zur Einrichtung": "Go to setup", "Jetzt verbinden": "Connect now",
  "Ihr Familienkalender in Home Assistant": "Your family calendar in Home Assistant",
  "Verbinden Sie Famalio mit einem Klick. Danach sehen Sie hier alle Termine und können Automationen daran knüpfen.": "Connect Famalio with one click. Afterwards you see all events here and can attach automations to them.",
  "Nach der Einrichtung erscheinen hier Ihre Kalender.": "Your calendars appear here after setup.",
  "Keine Termine in den nächsten 30 Tagen.": "No events in the next 30 days.",
  "Noch keine Automationen. Wählen Sie einen Termin und legen Sie fest, was passieren soll.": "No automations yet. Choose an event and decide what should happen.",
  "Tippen Sie auf einen Termin, um eine Aktion für ihn anzulegen.": "Select an event to create an action for it.",
  "Löschen fehlgeschlagen.": "Deleting failed.",
  "Wiederkehrende Termine bearbeiten Sie in der Famalio App.": "Edit repeating events in the Famalio app.",
  "Wiederkehrende und importierte Termine bleiben immer nur in der Famalio-App bearbeitbar.": "Repeating and imported events can only ever be edited in the Famalio app.",
  "So aktivierst du das Bearbeiten": "How to turn on editing", "Bearbeiten aktivieren": "Turn on editing",
  "Home Assistant darf deine Termine im Moment nur lesen. Du kannst hier trotzdem Automationen zu Terminen anlegen. Um Termine auch hier anzulegen, zu ändern oder zu löschen, musst du das in der Famalio-App erlauben:": "Home Assistant can only read your events at the moment. You can still create automations for events here. To also create, change or delete events here, you have to allow it in the Famalio app:",
  "Noch keine Famalio Integration eingerichtet. Verbinden Sie Home Assistant unter Einrichtung.": "No Famalio integration is set up yet. Connect Home Assistant under Setup.",
  "Öffne die Famalio-App auf deinem Handy.": "Open the Famalio app on your phone.",
  "Tippe auf Einstellungen → Famalio Home → Home-Server verbinden → Home Assistant.": "Tap Settings → Famalio Home → Connect Home server → Home Assistant.",
  "Unter „Verbunden“ die bestehende Verbindung löschen (nach links wischen → Widerrufen).": "Under “Connected”, delete the existing connection (swipe left → Revoke).",
  "Hier im Panel auf „Einrichtung → Mit Famalio verbinden“ tippen und den neuen Code in der App bestätigen.": "Here in the panel, tap “Setup → Connect with Famalio” and confirm the new code in the app.",
  "Dort den Schalter „Home Assistant darf bearbeiten“ einschalten und „Verbindung erlauben“ tippen.": "There, switch on “Allow Home Assistant to edit” and tap “Allow connection”.",
  "Noch nichts verknüpft. Zum Beispiel: 30 Minuten vor „Frühschicht“ das Licht im Flur einschalten.": "Nothing linked yet. For example: switch on the hallway light 30 minutes before “Early shift”.",
  "Gerät oder Entität hinzufügen …": "Add a device or entity …",
  "Leer lassen, wenn die Aktion kein Ziel braucht.": "Leave empty if the action needs no target.",
  "Tipp: Neue Termine sollten mehr als 15 Minuten in der Zukunft liegen, damit Home Assistant sie rechtzeitig sieht.": "Tip: new events should be more than 15 minutes in the future so Home Assistant sees them in time.",
  "Gespeichert. Home Assistant übernimmt ab jetzt.": "Saved. Home Assistant takes over from now on.",
  "Speichern fehlgeschlagen. Prüfen Sie Ihre Home Assistant Berechtigungen.": "Saving failed. Check your Home Assistant permissions.",
  "Bitte ein Stichwort eingeben.": "Please enter a keyword.", "Ungültige Aktion.": "Invalid action.",
  "Bitte eine Aktion auswählen.": "Please choose an action.",
  "Daten als JSON oder als einfache Zeilen „schlüssel: wert“ eingeben.": "Enter data as JSON or as simple “key: value” lines.",
  "Daten müssen ein Objekt sein.": "Data must be an object.",
  "Erstellt im Famalio Kalender.": "Created in the Famalio calendar.",
  "Bitte einen Titel eingeben.": "Please enter a title.", "Bitte gültige Daten wählen.": "Please choose valid dates.",
  "Bitte gültige Uhrzeiten wählen.": "Please choose valid times.",
  "Das Ende liegt vor dem Beginn.": "The end is before the start.", "Das Ende muss nach dem Beginn liegen.": "The end must be after the start.",
};

/** Texts with a variable part, e.g. a calendar name. `$1` is the captured text. */
export const PATTERNS = [
  [/^(\d+) Kalender verbunden$/, (n) => `${n} ${n === "1" ? "calendar" : "calendars"} connected`],
  [/^Titel enthält „(.*)“$/, (k) => `Title contains “${k}”`],
  [/^Alle „(.*)“$/, (k) => `All “${k}”`],
  [/^Jeder Termin in „(.*)“$/, (c) => `Every event in “${c}”`],
  [/^„(.*)“ wirklich löschen\?$/, (k) => `Really delete “${k}”?`],
  [/^Ausgelöst durch Termine in „(.*)“\. Home Assistant führt die Aktion aus, auch wenn dieses Fenster geschlossen ist\.$/,
    (c) => `Triggered by events in “${c}”. Home Assistant runs the action even when this window is closed.`],
  [/^Nicht erreichbar: (.*)\. Prüfen Sie die Verbindung und versuchen Sie es erneut\.$/, (l) => `Not reachable: ${l}. Check the connection and try again.`],
  [/^(.*) beginnt$/, (k) => `${k} starts`],
  [/^(.+) auswählen …$/, (k) => `Choose ${(EN[k] ?? k).toLowerCase()} …`],
];

/** Messages the add-on server sends in English; the German page shows these translated. */
export const SERVER_DE = {
  "Sign in to Tailscale to continue.": "Melde dich bei Tailscale an, um fortzufahren.",
  "Tailscale is connected; enable HTTPS for this tailnet, then check again.": "Tailscale ist verbunden. Aktiviere HTTPS für dein Tailnet und prüfe dann erneut.",
  "Waiting for a valid HTTPS certificate and verified internal endpoint.": "Warte auf ein gültiges HTTPS-Zertifikat und die geprüfte interne Verbindung.",
  "Waiting for Tailscale HTTPS.": "Warte auf Tailscale-HTTPS.",
  "Home Assistant discovery request accepted.": "Die Home-Assistant-Anfrage wurde angenommen.",
  "Approve this code in the Famalio app.": "Bestätige diesen Code in der Famalio-App.",
  "The request expired. Start a new one.": "Die Anfrage ist abgelaufen. Sende eine neue Anfrage.",
  "The request was declined in the app.": "Die Anfrage wurde in der App abgelehnt.",
  "The approved connection could not be picked up.": "Die bestätigte Verbindung konnte nicht übernommen werden.",
  "Home Assistant could not be connected.": "Home Assistant konnte nicht verbunden werden.",
  "Not found.": "Nicht gefunden.",
  "Supervisor ingress only.": "Nur über die Home-Assistant-Oberfläche erreichbar.",
  "Invalid request origin.": "Ungültiger Anfrage-Ursprung.",
  "CSRF validation failed.": "Sicherheitsprüfung fehlgeschlagen. Lade die Seite neu.",
  "JSON content type required.": "Ungültiges Anfrageformat.",
  "Internal setup error.": "Interner Fehler bei der Einrichtung.",
  "Invalid request.": "Ungültige Anfrage.",
  "Invalid JSON": "Ungültige Anfrage.",
  "Request too large": "Die Anfrage ist zu groß.",
  "Response too large": "Die Antwort ist zu groß.",
  "Upstream response too large": "Die Antwort des Servers ist zu groß.",
  "Redirect rejected": "Eine Weiterleitung wurde aus Sicherheitsgründen abgelehnt.",
  "Home Assistant discovery redirect rejected.": "Eine Weiterleitung wurde aus Sicherheitsgründen abgelehnt.",
  "Setup action failed.": "Die Einrichtungsaktion ist fehlgeschlagen.",
  "Enter an HTTPS origin without a path, query, or fragment.": "Gib eine HTTPS-Adresse ohne Pfad ein, z. B. https://name.tailnet.ts.net.",
  "Enter an HTTPS origin without path, query, or fragment.": "Gib eine HTTPS-Adresse ohne Pfad ein, z. B. https://name.tailnet.ts.net.",
  "Choose a supported network mode.": "Wähle eine unterstützte Zugangsart.",
  "Choose a valid network option first.": "Wähle zuerst einen gültigen Zugang.",
  "Create your Famalio Home family in the app first.": "Lege zuerst deine Famalio-Home-Familie in der App an.",
  "Finish the network step first.": "Schließe zuerst Schritt 1 (Zugang) ab.",
  "Select Tailscale first.": "Wähle zuerst Tailscale.",
  "Verify the HTTPS server identity before discovery.": "Prüfe zuerst die HTTPS-Serveridentität.",
  "Provide an app-created fhi_ integration grant.": "Gib einen in der App erzeugten Integrationstoken (fhi_) ein.",
  "HTTPS verification timed out": "Die HTTPS-Prüfung hat zu lange gedauert.",
  "Invalid HTTPS verification response": "Ungültige Antwort bei der HTTPS-Prüfung.",
  "Tailscale certificate request timed out.": "Die Tailscale-Zertifikatsanfrage hat zu lange gedauert.",
  "Tailscale HTTPS certificate could not be issued.": "Das Tailscale-HTTPS-Zertifikat konnte nicht ausgestellt werden.",
  "Tailscale certificate identity or validity is invalid.": "Das Tailscale-Zertifikat ist ungültig oder läuft bald ab.",
  "Tailscale DNS name is invalid.": "Der Tailscale-Name ist ungültig.",
  "Tailscale HTTPS is not ready.": "Tailscale-HTTPS ist noch nicht bereit.",
  "Tailscale HTTPS identity is unavailable.": "Die Tailscale-HTTPS-Identität ist nicht verfügbar.",
  "Local server identity is unavailable.": "Die Identität des lokalen Servers ist nicht verfügbar.",
  "Unexpected TLS server name.": "Unerwarteter Servername im Zertifikat.",
  "Unexpected add-on identity.": "Unerwartete Add-on-Identität.",
  "Home Assistant add-on identity could not be verified.": "Die Identität des Famalio-Add-ons konnte nicht geprüft werden.",
  "Home Assistant discovery is unavailable in this add-on runtime.": "Die Home-Assistant-Erkennung ist in dieser Umgebung nicht verfügbar.",
  "The HTTPS address points to a different Famalio instance.": "Die HTTPS-Adresse gehört zu einer anderen Famalio-Instanz.",
  "The HTTPS endpoint identifies a different server.": "Die HTTPS-Adresse gehört zu einem anderen Server.",
  "The HTTPS endpoint points to a different Famalio server.": "Die HTTPS-Adresse gehört zu einem anderen Famalio-Server.",
};

const SERVER_PATTERNS_DE = [
  [/^HTTPS verification returned (\d+)$/, (n) => `Die HTTPS-Prüfung antwortete mit Fehler ${n}.`],
  [/^Home Assistant discovery returned (\d+)\.$/, (n) => `Home Assistant antwortete mit Fehler ${n}.`],
  [/^Upstream returned (\d+)$/, (n) => `Der Server antwortete mit Fehler ${n}.`],
];

/** German text for a known English server message; anything else is returned unchanged. */
export function fromServer(text) {
  if (typeof text !== "string") return text;
  const core = text.trim();
  if (!core) return text;
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  const direct = SERVER_DE[core];
  if (direct !== undefined) return lead + direct + trail;
  for (const [pattern, build] of SERVER_PATTERNS_DE) {
    const match = core.match(pattern);
    if (match) return lead + build(...match.slice(1)) + trail;
  }
  return text;
}

const STORAGE_KEY = "famalio.panel.lang";

export function currentLanguage(search = globalThis.location?.search ?? "", stored = null, browser = globalThis.navigator?.language ?? "de") {
  const asked = new URLSearchParams(search).get("lang");
  const pick = asked || stored || browser || "de";
  return String(pick).toLowerCase().startsWith("de") ? "de" : "en";
}

export function translate(text, lang = "en") {
  if (lang !== "en" || typeof text !== "string") return text;
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  const core = text.trim();
  if (!core) return text;
  const direct = EN[core];
  if (direct !== undefined) return lead + direct + trail;
  for (const [pattern, build] of PATTERNS) {
    const match = core.match(pattern);
    if (match) return lead + build(...match.slice(1)) + trail;
  }
  return text;
}

const ATTRIBUTES = ["placeholder", "aria-label", "title", "alt"];

/** Keeps a page in English (or German again) and follows later changes. */
export function install(documentRef = document, lang = currentLanguage(undefined, safeStored())) {
  const originals = new WeakMap();
  let language = lang;

  const textNode = (node) => {
    const original = originals.has(node) ? originals.get(node) : null;
    const current = node.nodeValue;
    if (original && current !== original.shown) originals.delete(node); // the page wrote new text
    const source = originals.has(node) ? originals.get(node).source : current;
    const shown = language === "en" ? translate(source, "en") : fromServer(source);
    if (shown !== current) node.nodeValue = shown;
    originals.set(node, { source, shown });
  };
  const attributes = (element) => {
    for (const name of ATTRIBUTES) {
      if (!element.hasAttribute?.(name)) continue;
      const key = `__i18n_${name}`;
      const current = element.getAttribute(name);
      const stored = element[key];
      if (stored && stored.shown !== current) element[key] = undefined;
      const source = element[key]?.source ?? current;
      const shown = language === "en" ? translate(source, "en") : fromServer(source);
      if (shown !== current) element.setAttribute(name, shown);
      element[key] = { source, shown };
    }
  };
  const walk = (root) => {
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1) return;
    if (["SCRIPT", "STYLE"].includes(root.tagName)) return;
    attributes(root);
    for (const child of root.childNodes) walk(child);
  };

  const observer = new MutationObserver((records) => {
    observer.disconnect();
    for (const record of records) {
      if (record.type === "characterData") textNode(record.target);
      else if (record.type === "attributes") attributes(record.target);
      else for (const node of record.addedNodes) walk(node);
    }
    observe();
  });
  const observe = () => observer.observe(documentRef.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });

  const apply = () => { observer.disconnect(); walk(documentRef.body); documentRef.documentElement.lang = language; documentRef.title = translate(documentRef.title, language) || documentRef.title; observe(); };
  apply();

  const toggle = documentRef.getElementById?.("lang-toggle");
  if (toggle) {
    toggle.textContent = language === "en" ? "DE" : "EN";
    toggle.addEventListener("click", () => {
      language = language === "en" ? "de" : "en";
      try { globalThis.localStorage?.setItem(STORAGE_KEY, language); } catch { /* private mode */ }
      toggle.textContent = language === "en" ? "DE" : "EN";
      apply();
    });
  }
  return { get language() { return language; }, apply };
}

function safeStored() {
  try { return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null; } catch { return null; }
}

if (typeof document !== "undefined" && document.body) install();
else if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => install());
