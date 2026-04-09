# Zendesk Dashboard — Istruzioni Deploy
# Tempo stimato: 15-20 minuti, zero esperienza richiesta

## COSA TI SERVE
- Un Mac (ce l'hai già)
- Connessione internet
- 3 account gratuiti: GitHub, Vercel, Vercel KV (tutti gratuiti)

---

## PASSO 1 — Crea account GitHub (se non ce l'hai)
1. Vai su https://github.com
2. Clicca "Sign up"
3. Inserisci email, password, username
4. Verifica l'email

---

## PASSO 2 — Crea account Vercel
1. Vai su https://vercel.com
2. Clicca "Sign Up"
3. Scegli "Continue with GitHub" (si collega in automatico)

---

## PASSO 3 — Installa gli strumenti sul Mac
Apri il Terminale (cerca "Terminale" in Spotlight) e copia-incolla questi comandi uno alla volta:

```bash
# Installa Homebrew (gestore pacchetti per Mac)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Installa Node.js
brew install node

# Installa Vercel CLI
npm install -g vercel

# Installa Git (probabilmente già presente)
brew install git
```

---

## PASSO 4 — Carica il progetto su GitHub

```bash
# Vai nella cartella del progetto
cd ~/Downloads/zendesk-dashboard

# Inizializza git
git init
git add .
git commit -m "primo deploy"

# Crea repository su GitHub (ti chiederà di autenticarti)
gh repo create zendesk-dashboard --public --source=. --push
```

Se `gh` non è installato:
```bash
brew install gh
gh auth login
```
Poi riprova il comando `gh repo create` qui sopra.

---

## PASSO 5 — Deploy su Vercel

```bash
# Dalla cartella zendesk-dashboard
vercel

# Rispondi alle domande:
# Set up and deploy? → Y
# Which scope? → scegli il tuo account
# Link to existing project? → N
# Project name? → zendesk-dashboard (premi Invio)
# Directory? → ./ (premi Invio)
# Override settings? → N
```

Vercel ti darà un URL tipo: https://zendesk-dashboard-xxxx.vercel.app
Aprilo nel browser — per ora mostrerà un errore perché mancano le variabili d'ambiente.

---

## PASSO 6 — Configura le variabili d'ambiente

Vai su https://vercel.com/dashboard, clicca sul tuo progetto, poi:
Settings → Environment Variables

Aggiungi queste variabili (clicca "Add" per ognuna):

| Name                | Value                                    |
|---------------------|------------------------------------------|
| ZENDESK_SUBDOMAIN   | espressocoffeeshophelp                   |
| ZENDESK_EMAIL       | federico@espressocoffeeshop.com          |
| ZENDESK_TOKEN       | Lfjwd5yKHLduJEipZ2ii4zJeHBt324HNJ65CHEmi|
| CRON_SECRET         | scegli una password lunga qualsiasi      |

Per CRON_SECRET puoi usare qualcosa come: ECS_Dashboard_2024_secret

Dopo aver aggiunto le variabili, clicca "Redeploy" in alto a destra.

---

## PASSO 7 — Aggiungi Vercel KV (database per la cache)

1. Vai su https://vercel.com/dashboard → Storage → Create Database
2. Scegli "KV (Redis)" → Create
3. Connetti al progetto "zendesk-dashboard"
4. Vercel aggiungerà automaticamente le variabili KV al progetto

---

## PASSO 8 — Primo caricamento dati

Vai sull'URL della tua dashboard e clicca "Aggiorna ora".
La prima volta scaricherà tutto lo storico (qualche minuto).
Poi ogni notte alle 3:00 si aggiorna automaticamente.

---

## RIEPILOGO COSTI
- GitHub: GRATIS
- Vercel: GRATIS (piano hobby, più che sufficiente)
- Vercel KV: GRATIS fino a 30.000 richieste/mese (abbondante)

---

## AGGIORNARE IL CODICE IN FUTURO
Se vuoi modificare qualcosa, modifica i file e poi:
```bash
cd ~/Downloads/zendesk-dashboard
git add .
git commit -m "aggiornamento"
git push
```
Vercel si aggiorna automaticamente in 30 secondi.

---

## PROBLEMI COMUNI

**"command not found: vercel"**
→ Chiudi e riapri il Terminale, poi riprova

**La dashboard mostra errore**
→ Controlla che le variabili d'ambiente siano corrette in Vercel Settings

**Il cron non si attiva**
→ Il cron funziona solo sul piano Pro di Vercel.
  Sul piano gratuito usa il bottone "Aggiorna ora" manualmente,
  oppure metti un segnalino nel calendario per aggiornare una volta a settimana.
  In alternativa puoi usare https://cron-job.org (gratis) per chiamare
  https://tuourl.vercel.app/api/refresh ogni notte.
