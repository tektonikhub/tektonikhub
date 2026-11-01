# Tektonik hub

Plataforma propuesta para registrar, revisar y distribuir micro-aplicaciones creadas con IA por empleados, con supervisión de IT / CISO.

**Estado actual:** aplicación React nativa con **Next.js App Router, TypeScript estricto y Tailwind CSS 4**, componentes reutilizables, Studio y repositorio de datos intercambiable. El código actual conecta el acceso y el negocio con InsForge: `/login` valida usuario/correo y contraseña, la sesión se conserva mediante cookies SSR y PostgreSQL asigna empresa y rol. `data.json` y el adaptador local quedan como fixtures de demostración/pruebas; no conceden acceso al portal. Los borradores Studio siguen en el navegador. El almacenamiento de binarios y el sandbox de ejecución de servidor siguen pendientes.

> Los nombres, métricas, tickets y sellos de seguridad son datos de demostración. Los textos sobre SOC 2, DLP, GDPR, Zero-Retention, AWS, SAP u Okta no acreditan certificaciones ni integraciones implementadas. No introducir documentación corporativa ni credenciales en las peticiones. La única excepción es la API key de Azure en el formulario LLM Settings, usando el servidor Node local de confianza.

## Inicio rápido: aplicación Next.js

Se recomienda **Node.js 22 LTS**, con npm instalado. Ejecutar los comandos desde PowerShell.

### 1. Entrar en la carpeta del proyecto

```powershell
Set-Location "C:\Users\Claudia\Desktop\Mis Webs\blk"
```

### 2. Instalar dependencias — solo la primera vez

Si ya existe `node_modules` y la aplicación funciona, no hace falta reinstalar en cada arranque. En una instalación nueva, o para restaurar exactamente las dependencias del lockfile:

```powershell
npm ci
```

### 3. Arrancar en desarrollo

```powershell
npm run dev
```

Mantener esta terminal abierta. Next prepara los recursos automáticamente y recarga la aplicación al guardar cambios.

- **Portada:** [http://127.0.0.1:3000](http://127.0.0.1:3000)
- **Entrada:** [http://127.0.0.1:3000/login](http://127.0.0.1:3000/login)

Entrar con una cuenta autorizada y activada de InsForge. No se elige empresa ni rol en el formulario. El servidor necesita la configuración de `.env.example` en `.env.local`; las claves administrativas se mantienen exclusivamente en el servidor. Azure no es necesario para iniciar sesión.

### Primera cuenta y activación

Si el backend está vacío, `/login` lo indica y no ofrece un acceso ficticio. El responsable del despliegue debe reservar la primera cuenta desde esta carpeta, con su propio correo y un nombre de usuario de 3 a 64 caracteres:

```powershell
npm run accounts:bootstrap -- "correo-del-responsable@empresa.com" "administrador"
```

Este comando carga el entorno local y usa `tk_bootstrap` para crear exclusivamente la cuenta de superadministrador y su organización/plan iniciales. No migra el fixture ni crea usuarios de ejemplo. Solicita un correo de verificación; no imprime ni comparte ninguna contraseña provisional.

Abrir el enlace de verificación recibido. En `/reset-password?activate=1`, solicitar después el enlace de contraseña con el mismo usuario o correo. Abrir ese segundo enlace, elegir una contraseña de al menos 15 caracteres y entrar en `/login`. Las siguientes cuentas se invitan desde Usuarios con su empresa y sus permisos asignados.

Si el envío falla después de reservar la cuenta, no volver a crearla. Repetir el mismo correo y usuario con `--resend`:

```powershell
npm run accounts:bootstrap -- "correo-del-responsable@empresa.com" "administrador" --resend
```

Los enlaces enviados usan `APP_URL` (o `NEXT_PUBLIC_APP_URL`) y sus destinos deben estar autorizados en la configuración de InsForge. El entorno local actual apunta al dominio publicado; no cambiar el origen de recuperación a una URL no autorizada. El acceso local en desarrollo permite `localhost:3000` y `127.0.0.1:3000`.

### 4. Detener y volver a arrancar

En la terminal donde se ejecuta el servidor, pulsar **Ctrl+C**. Para volver a iniciarlo:

```powershell
npm run dev
```

Si Copilot lo inició en segundo plano, pedirle que detenga ese servidor; no finalizar otros procesos Node por su nombre. No iniciar otra instancia en el mismo puerto. Si aparece `EADDRINUSE`, comprobar qué servidor ocupa el puerto 3000 antes de detenerlo.

### Alternativa: build optimizado de producción local

Detener primero el servidor de desarrollo, ya que ambos usan el puerto 3000. Después:

```powershell
npm run build
npm start
```

Abrir la misma URL. `npm start` requiere un build previo y no recarga cambios de código: para aplicar cambios, detener, reconstruir y arrancar de nuevo.

El servidor local escucha únicamente en `127.0.0.1`; esos comandos no lo publican en Internet ni en la red local. El despliegue público en InsForge se describe más abajo. Azure es opcional y tiene sus comandos separados.

| Pantalla | Ruta React |
|---|---|
| Portada ES/EN | `/` |
| Acceso real | `/login` |
| Activación y contraseña | `/reset-password` |
| Catálogo aprobado | `/catalog` |
| Perfil y envíos | `/profile` |
| Organización y gestión | `/company` |
| Creación conversacional | `/studio` |
| Oficina de IA | `/admin` |
| Administración global | `/super-admin` |

Solo se utilizan las rutas React de esta tabla. `predev` y `prebuild` preparan el fixture y los motores actuales de Studio; las URLs del prototipo no se sirven ni redirigen.

### Arquitectura y autenticación

```text
React / hooks → BLKProvider → RemoteBLKRepository → API Next.js
                                                   ↓
                            Sesión SSR + tk_identity / tk_workspace + RLS
                                                   ↓
                                         PostgreSQL / InsForge
```

La estructura `app`, `components`, `hooks`, `lib`, `public`, `styles`, `scripts` y `tests`, las fronteras de Studio, el mapa de rutas y el plan de integración están documentados en [docs/NEXT_ARCHITECTURE.md](docs/NEXT_ARCHITECTURE.md). La implementación usa componentes React y un repositorio TypeScript independiente para el negocio. El único iframe es la preview aislada del documento generado por Studio.

La UI conserva creación → revisión → cambios → reenvío → aprobación → catálogo, con versiones y confirmaciones manuales. Incluye CRUD empresarial, organizaciones, usuarios, planes, políticas y marca. Las rutas protegidas comprueban la identidad y el rol en el servidor; las operaciones de negocio también pasan por las políticas de PostgreSQL. Idiomas operativos parciales; no hay certificaciones, telemetría ni cobros reales.

Tras iniciar sesión se vuelve a la ruta solicitada solo si ese rol tiene acceso; en caso contrario se usa su destino autorizado. `/login` redirige las sesiones existentes. La renovación actualiza las cookies del navegador y de la misma petición SSR; un fallo temporal del backend no borra el refresh token. Cerrar sesión elimina las cookies compartidas y avisa a las otras pestañas. No implica revocar todos los tokens ya emitidos por InsForge.

### Backend InsForge aprovisionado

El proyecto cloud **`tektonik-hub`** está creado en **EU Central (`eu-central`)** y vinculado a esta carpeta. Su URL de backend es `https://vxpd968k.eu-central.insforge.app`; el [panel de InsForge](https://insforge.dev/dashboard/project/621de563-b6b4-4041-b541-579e6128a916) permite administrar sus servicios.

Desde la raíz del proyecto, se puede comprobar la conexión sin modificar datos:

```powershell
npx -y @insforge/cli@latest current
npx -y @insforge/cli@latest db query "SELECT 1 AS ok" --json
```

`AGENTS.md` describe el contexto de la aplicación y dirige a las skills locales `insforge-cli` para infraestructura e `insforge` para código de integración. `.insforge\project.json` contiene la conexión y una clave administrativa: lo administra la CLI y queda excluido por `.gitignore`, igual que los archivos de entorno locales. No compartir ese archivo ni publicar claves administrativas en variables `NEXT_PUBLIC_*`.

Los comandos usan `@latest` porque la invocación sin versión en este entorno resolvía una CLI antigua que no incluía los comandos de memoria ni feedback documentados.

El SDK y la migración de identidad/negocio están presentes. El backend no importa automáticamente `data.json` ni `localStorage`: necesita cuentas reales autorizadas y los datos que sus administradores creen. El alta inicial se describe arriba.

### Aplicación desplegada en InsForge

- **Aplicación:** [https://vxpd968k.insforge.site](https://vxpd968k.insforge.site)
- **Entrada:** [https://vxpd968k.insforge.site/login](https://vxpd968k.insforge.site/login)

El frontend se publica como una aplicación Next.js mediante el hosting gestionado de InsForge, cuyo proveedor de despliegue es Vercel. No es una exportación estática ni requiere reescrituras SPA hacia `index.html`.

Para volver a publicar cambios, ejecutar desde esta carpeta:

```powershell
npm run build
npx -y @insforge/cli@latest deployments deploy . --json
```

Se despliega la raíz del código fuente, no `.next`. Los scripts npm utilizan rutas portables para Windows y el servidor Linux de construcción. `.vercelignore` excluye credenciales, conexión local, herramientas de agentes, documentación, el archivo `Old` y otros archivos que no forman parte de la aplicación.

`BLK_ENABLE_LOCAL_LLM=false` está guardado como variable persistente del despliegue. El puente Azure local permanece deshabilitado en producción; Studio conserva su motor demo.

El dominio publicado refleja el último despliegue, no los cambios de la carpeta hasta volver a publicar. El código de acceso real requiere también `NEXT_PUBLIC_INSFORGE_URL`, `NEXT_PUBLIC_INSFORGE_ANON_KEY`, `APP_URL`/`NEXT_PUBLIC_APP_URL` y `INSFORGE_API_KEY` en el entorno del despliegue. El comando local de primera cuenta no publica el frontend. Los antiguos datos de navegador no se transfieren a InsForge.

### Azure en la aplicación Next (opcional)

El motor demo de Studio funciona sin Azure. Para habilitar el proveedor real **solo en desarrollo local**:

```powershell
# Terminal 1
npm run dev:llm

# Terminal 2
$env:BLK_ENABLE_LOCAL_LLM = "true"
$env:BLK_LOCAL_LLM_PORT = "8027"
npm run dev
```

Admin → `/admin` → configuración → LLM Settings. Después cambiar a developer y abrir `/studio`. Las claves permanecen en memoria del servidor Node; el puente Next valida host/origen/CSRF y límites, y está desactivado por defecto y en producción. No publicar ni tunelizar estos puertos. Consulta [la guía completa](docs/NEXT_ARCHITECTURE.md#azure-opcional-conservar-el-mvp-local).

### Validación Next y regresión

```powershell
npm run typecheck
npm run lint
npm run test:next
npm run test:next:auth
npm run test:next:llm
npm test
npm run build
npm run test:next:browser
```

`npm test` valida los motores actuales, su sandbox y la API LLM local; `test:next` valida el repositorio TypeScript, Studio, las reglas de autenticación y la frontera de plataforma. `test:next:auth` prueba la UI y las APIs Next con un backend sintético de loopback: credenciales, los cuatro roles, rutas protegidas, cookies, recarga, renovación, cierre entre pestañas, contraseña y reintento del alta inicial. No crea cuentas ni envía correos en el proyecto cloud. `test:next:llm` verifica el puente Azure simulado. El runner histórico `test:next:browser` conserva escenarios del selector demo y no representa el acceso real; para `/login`, usar `test:next:auth`. Instalar Chromium con `npx playwright install chromium` solo si no hay un navegador disponible.

## Marca

La marca visible es **Tektonik hub** y Studio se presenta como **Tektonik hub Studio**. El monograma es **TH**. Páginas, metadatos, fixtures, exportaciones y archivo histórico utilizan esta identidad; los dominios ficticios usan `tektonikhub.example`, sin asumir un dominio real.

Los identificadores técnicos existentes (`BLKProvider`, las claves `blkunit:*`, los selectores de documentos Studio y el protocolo LLM) se conservan por compatibilidad: no son la marca visible y evitan perder sesiones, preferencias o borradores guardados. La carpeta local tampoco cambia de nombre.

## My flow: validación UI independiente

`my-flow.html`, en la raíz, es un prototipo autocontenido inspirado en el catálogo: una rueda/carrusel de mini apps que combina herramienta, agente y workflow. Se abre directamente en el navegador con doble clic, sin servidor, instalación ni conexión a Internet; CSS, JavaScript, iconos y fuentes están incluidos en el mismo HTML.

Permite explorar la órbita o las tarjetas, buscar y filtrar, marcar favoritos, cambiar agentes, crear/configurar flows y probar una ejecución simulada con aprobación manual. Los datos y resultados son ficticios; no utiliza `data.json`, el catálogo, Next.js ni InsForge. Guarda únicamente sus configuraciones demo bajo la clave local independiente `tektonik_my_flow_ui_v1`; la actividad de las simulaciones dura solo durante la sesión. No forma parte de las rutas React ni del despliegue de la aplicación.

## Archivo histórico

`Old` contiene el prototipo anterior completo y su propia documentación. No forma parte de la aplicación, no se publica y no se carga durante desarrollo, build o ejecución. Las rutas actuales no tienen enlaces ni redirecciones al prototipo. Los motores de Studio se mantienen como código propio en `lib\studio\runtime`; el servicio `server\llm.cjs` ofrece exclusivamente la API LLM local opcional, sin servir páginas ni assets antiguos.
