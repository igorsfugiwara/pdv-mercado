import { app, BrowserWindow, session as electronSession } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import log from 'electron-log'
import { initDb } from './db/index'
import { seedDatabase } from './db/seed'
import { registerIpc } from './ipc/handlers'
import { initFiscal } from './fiscal'
import { backupAgora } from './services/backup'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Diretórios de runtime em userData (seção 2.1). Nunca versionados.
 *
 * `PDV_DATA_DIR` existe para o teste E2E rodar contra um banco descartável.
 * Sem isso, o teste usaria o banco de desenvolvimento: passaria na máquina de
 * quem escreveu e falharia no CI — ou, pior, apagaria o banco de quem estava
 * trabalhando.
 */
const DATA_DIR = process.env.PDV_DATA_DIR
  ? join(process.env.PDV_DATA_DIR, 'data')
  : join(app.getPath('userData'), 'data')
const DB_PATH = join(DATA_DIR, 'pdv.db')
// Em produção as migrations vão empacotadas; em dev, lidas do source.
const MIGRATIONS_DIR = app.isPackaged
  ? join(process.resourcesPath, 'electron', 'db', 'migrations')
  : join(__dirname, '..', 'electron', 'db', 'migrations')

log.transports.file.resolvePathFn = () => join(DATA_DIR, 'logs', 'main.log')

let win: BrowserWindow | null = null

async function bootstrap() {
  initDb(DB_PATH, MIGRATIONS_DIR)
  if (!app.isPackaged) await seedDatabase() // seeds só em desenvolvimento
  registerIpc(DATA_DIR)
  await initFiscal((msg) => win?.webContents.send('fiscal:alerta', msg))
  agendarBackupDiario()
}

function agendarBackupDiario() {
  // RNF-05: backup diário automático.
  const UM_DIA = 24 * 60 * 60 * 1000
  const rodar = () => {
    try {
      backupAgora(join(DATA_DIR, 'backups'))
    } catch (e) {
      log.error('[backup] falhou', e)
    }
  }
  setInterval(rodar, UM_DIA)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0F0F0F',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      nodeIntegration: false, // seção 2.2
      contextIsolation: true,
      sandbox: false, // preload precisa de require p/ contextBridge
    },
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
    // DevTools só quando pedido (PDV_DEVTOOLS=1). Abrir sempre criava uma segunda
    // janela destacada a cada boot, e ficava ambíguo qual das duas é o app.
    if (process.env.PDV_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
    win.focus()
  } else {
    win.loadFile(join(__dirname, '..', 'dist', 'index.html'))
  }
}

// RNF-06: bloqueia qualquer navegação/conexão externa fora do módulo fiscal.
function hardenNetwork() {
  electronSession.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const url = details.url
    const permitido =
      url.startsWith('file:') ||
      url.startsWith('devtools:') ||
      url.startsWith(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost') ||
      // O HMR do Vite abre um websocket no mesmo host do dev server; sem isto o
      // hot reload morre em desenvolvimento. RNF-06 é sobre request EXTERNA — o
      // próprio bundler na máquina local não é. Em produção não há dev server.
      (!app.isPackaged && /^wss?:\/\/localhost(:\d+)?\//.test(url))
    if (!permitido) {
      log.warn('[net] request externa bloqueada:', url)
      return cb({ cancel: true })
    }
    cb({})
  })
}

app.whenReady().then(async () => {
  try {
    await bootstrap()
  } catch (e) {
    log.error('[boot] falha na inicialização', e)
  }
  hardenNetwork()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
