# Tektonik hub: Next.js e InsForge

## Arquitectura actual

La aplicación utiliza Next.js App Router, React, TypeScript estricto y Tailwind CSS 4. Las pantallas son React nativas.

```text
Pantallas / hooks React
          ↓
BLKProvider → RemoteBLKRepository
                    ↓
              API Next.js
                    ↓
       Cookies SSR / tk_identity
                    ↓
    tk_workspace / tk_command / RLS
                    ↓
          PostgreSQL / InsForge
```

El backend de identidad y negocio está conectado al proyecto `tektonik-hub`. La URL publicada, activación de la primera cuenta y despliegue están en [README](../README.md). El negocio utiliza exclusivamente el espacio autorizado remoto; no depende de datasets de demostración.

## Ejecutar y publicar

Se recomienda Node.js 22 LTS. En una instalación nueva, ejecutar `npm ci`; después `npm run dev` desde PowerShell. El servidor escucha en `http://127.0.0.1:3000`. Para producción local, ejecutar `npm run build` y `npm start`.

El servidor necesita las variables documentadas en `.env.example`, guardadas localmente en `.env.local`. El acceso utiliza una cuenta autorizada, activada y habilitada de InsForge, no un selector demo.

`next build --webpack` prepara una aplicación con handlers y renderizado de servidor. No existe exportación estática ni reescritura SPA hacia `index.html`. Para publicar, construir primero y ejecutar `npx -y @insforge/cli@latest deployments deploy . --json` sobre la raíz fuente, no `.next`. Las variables persistentes del hosting deben estar configuradas antes del despliegue; el puente LLM local permanece desactivado en producción.

## Estructura

```text
app\                         Rutas, layouts, estados y handlers Next.js
  (platform)\                Pantallas protegidas en el servidor
  login\                     Usuario/correo y contraseña
  reset-password\            Activación y recuperación
  api\                       Autenticación, negocio, fuente Studio y LLM local
components\
  ui\                        Button, Badge, Dialog, PageHeading
  auth\                      Guardas y estados sin acceso
  providers\                 Repositorio, idioma, marca y notificaciones
  layout\                    AppShell responsive y portada
  features\                  Catálogo, perfiles, gestión y revisiones
  studio\                    Conversación, versiones, edición y preview
hooks\                       Estado de negocio y borradores Studio
lib\
  auth\                      Políticas de autenticación y destinos
  domain\                    Entidades y contratos TypeScript
  data\                      Adaptador remoto y validación
  config\                    Tokens y aplicación segura de marca
  studio\                    Motores, fuente remota y borradores locales
    runtime\                 Motores JavaScript propios
  server\                    SDK SSR, autorización, errores y puente local
styles\                      Diseño Tektonik hub y Tailwind
scripts\                     Recursos públicos y alta inicial autorizada
tests\                       Contratos, motores y HTTP/Chromium
migrations\                  Historial aplicado de identidad y negocio
database\                    Diseño PostgreSQL histórico/propuesto
server\llm.cjs               API Azure opcional, exclusivamente local
```

El layout declara las fuentes corporativas con fallback de sistema; no descarga fuentes durante el build. El shell mantiene topbar de 60 px, sidebar de 260 px, scroll independiente, navegación móvil, teclado, diálogos nativos y tokens compartidos.

`predev` y `prebuild` ejecutan `scripts\sync-public.cjs`, que prepara solo los motores actuales bajo `/engines` y elimina las copias públicas de datasets y prototipos obsoletos. No publica servidores, SQL, documentación ni credenciales. Los recursos generados están ignorados por Git. La portada no muestra conteos de negocio ficticios ni carga archivos de datos.

## Rutas e identidad

| Pantalla | Ruta |
|---|---|
| Portada | `/` |
| Acceso real | `/login` |
| Activación y contraseña | `/reset-password` |
| Catálogo aprobado | `/catalog` |
| Perfil y envíos | `/profile` |
| Organización | `/company` |
| Studio | `/studio` |
| Oficina de IA | `/admin` |
| Administración global | `/super-admin` |

`/login?next=...` acepta únicamente destinos internos conocidos y autorizados para el rol. Parámetros de rol y valores de `sessionStorage` no cambian la identidad. Las URLs antiguas y `Old` devuelven 404; no existen aliases hacia el prototipo.

Los helpers SSR de `@insforge/sdk` mantienen la sesión en cookies: refresh token httpOnly y access token de corta duración legible para integraciones del SDK. `authenticatedContext` comprueba el usuario verificado y `tk_identity`; esta última exige una cuenta pública habilitada, no archivada, correo coincidente y empresa activa, con la excepción prevista para superadministradores.

Cada operación vuelve a comprobar la identidad. Suspender una empresa bloquea sus flujos de negocio sin borrar datos ni revocar todos los tokens ya emitidos. Cerrar sesión elimina las cookies compartidas y comunica el cambio a otras pestañas. Fallos temporales de renovación conservan el refresh token y muestran un error, no un acceso ficticio.

## Contrato de negocio y base de datos

`lib\data\repository.ts` define el contrato asíncrono independiente de la UI. `RemoteBLKRepository` recibe el snapshot inicial del servidor, envía comandos a `/api/workspace` y refresca el espacio tras las mutaciones. No escribe tablas con credenciales administrativas ni almacena la identidad de negocio en el navegador.

`GET /api/workspace` ejecuta `tk_workspace` y valida sus proyecciones frontend. `POST /api/workspace` valida origen y campos estrictos antes de llamar a `tk_command`. Las escrituras se ejecutan transaccionalmente con autorización, restricciones de tenant, referencias y versión esperada. RLS y privilegios SQL protegen las lecturas autenticadas.

La migración aplicada `migrations\20261101075915_identity-workspace.sql` define las 15 tablas de negocio actuales, versiones inmutables, revisiones, eventos, altas, políticas y marca. El esquema de 25 tablas en `database` es histórico/propuesto: **no debe aplicarse encima del backend actual**. El mapa de persistencia futura de Studio tampoco significa que existan borradores cloud.

Los miembros de una organización son el número de cuentas públicas no archivadas; una cuenta deshabilitada sigue registrada. El formulario muestra este valor como solo lectura y la API rechaza un campo `members` fabricado. El administrador debe ser una cuenta válida y habilitada de la misma empresa; su correo de acceso no se cambia desde la organización.

Las revisiones y ediciones requieren la versión esperada. Aprobar exige checks manuales de seguridad y datos; pedir cambios o rechazar exige motivo. Una edición vuelve a revisión y retira la app del catálogo hasta su nueva aprobación. Archivar usuarios, aplicaciones u organizaciones conserva los históricos correspondientes, sujeto a protecciones de plataforma y relaciones.

Los límites de formulario y API se ajustan a PostgreSQL: título 60, resumen 100, descripción 30–800, contadores enteros hasta 2147483647 y precio informativo hasta 9999999999.99. Los precios no implican checkout ni facturación. Los adjuntos son metadatos: no se suben binarios a Storage.

Errores de permisos producen 403; versiones concurrentes y conflictos, 409; campos o reglas inválidos, 400. Un fallo inesperado del backend se registra sin secretos y devuelve 503. Las respuestas de negocio y de fuente usan `Cache-Control: private, no-store`.

## Studio: borrador local y fuente en InsForge

La interfaz, conversación y controles son React. Los motores puros de `lib\studio\runtime` generan documentos offline. Un borrador contiene configuración, conversación, versiones, procedencia y metadatos, con clave `blkunit:studio:v1:ORG:USER:EDIT`. Se conservan hasta ocho versiones y cuarenta mensajes. El borrador no se sincroniza entre dispositivos; idioma y marca tienen sus propias preferencias de navegador.

Un envío a IT guarda el HTML en `app_versions.generated_html` junto con la versión del ticket. `tk_workspace` devuelve resúmenes, no todos los HTML. Al abrir `/studio?edit=ID` sin versiones locales válidas, Studio solicita exclusivamente esa versión a `GET /api/studio/source?appId=ID&version=N`.

La fuente se consulta con el cliente autenticado y RLS, filtrando empresa y autor. El endpoint solo permite al developer propietario corregir una app no archivada con cambios solicitados; exige la versión vigente. Una versión obsoleta o inexistente falla explícitamente. Un HTML nulo identifica una entrega sin documento: la UI permite generar una nueva versión y lo explica.

La recuperación conserva HTML, datos/configuración de dashboard, procedencia del generador, adjuntos de referencia y versión esperada. No reemplaza un borrador local válido o corrupto; un JSON dañado permanece protegido hasta un reemplazo o reinicio confirmado. Una respuesta pendiente de otro ticket o sesión no puede poblar el borrador actual. La presentación a IT comprueba de nuevo la versión en la transacción.

El único iframe muestra el documento generado con `sandbox="allow-scripts"`, sin `allow-same-origin`, y CSP offline que bloquea la red. El servidor Next no ejecuta el documento. El preview se reinicia al remontarlo. Esto no constituye un sandbox productivo, una certificación ni un escáner de seguridad.

Formulario, kanban y calculadora usan acciones locales de click/Enter sin enviar formularios a la red. Los dashboards son configuraciones declarativas sobre datos sintéticos: Azure devuelve JSON validado y el renderer confiable crea el HTML. No se ofrece generación libre de código, conectores corporativos ni ejecución cloud. Fallos y cancelaciones conservan la última versión completa sin cambiar silenciosamente de motor.

## Azure opcional: conservar el MVP local

Está desactivado por defecto y siempre desactivado en producción. Para probarlo:

```powershell
# Terminal 1: servidor local, claves en memoria
npm run dev:llm

# Terminal 2: activación explícita de desarrollo
$env:BLK_ENABLE_LOCAL_LLM = "true"
$env:BLK_LOCAL_LLM_PORT = "8027"
npm run dev
```

Entrar con una cuenta autorizada Admin en `/admin` → configuración → LLM Settings. Configurar endpoint Azure público clásico, deployment, versión de API y clave, y probar conexión. Cerrar sesión e iniciar con un developer autorizado para usar Azure en `/studio`. Cada llamada real consume cuota. El motor demo no necesita Azure.

El puente Next solo permite handlers enumerados, host/origen locales coincidentes, JSON acotado y CSRF. Reenvía a un puerto loopback válido, nunca a un destino arbitrario del cliente. Propaga timeouts, cancelación y errores sin secretos ni caché.

`server\llm.cjs` no sirve páginas ni assets. Mantiene claves por organización en memoria; restringe Azure a HTTPS `*.openai.azure.com`, cuerpo/respuesta a 250 KB, 60 segundos, una llamada por organización, dos globales y doce por minuto/organización. Next concede 65 segundos para comunicar ese límite.

**No publicar ni tunelizar estos puertos.** Host/Origin/CSRF no autentican procesos locales, y los IDs del puente no sustituyen la autorización multiempresa. Un proveedor LLM productivo requerirá identidad, secretos cifrados, costes y controles propios; no se traslada esta configuración a InsForge.

## Validación reproducible

```powershell
npm run typecheck
npm run lint
npm run test:next
npm run test:next:auth
npm test
npm run build
```

`test:next` cubre contratos, repositorios, autenticación y borradores. `test:next:auth` usa Next y Chromium con un backend sintético de loopback: login, roles, cookies, renovación, contraseña, activación, recuperación de fuentes, permisos, conflictos y formularios. No crea cuentas ni envía correos cloud. `npm test` cubre motores, sandbox y API local.

`test:next:llm` comprueba opcionalmente el puente Next → servicio local → Azure simulado. Las pruebas de autenticación utilizan respuestas sintéticas autocontenidas, sin depender de datasets históricos. El validador de `database` comprueba el modelo histórico, no la migración aplicada.

Los tests no constituyen certificación, pentest, auditoría completa de accesibilidad ni prueba de carga. El acceso publicado con una cuenta real requiere que su responsable complete la activación; no se crean identidades cloud ficticias para aparentar esa comprobación.
