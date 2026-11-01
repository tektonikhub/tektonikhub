# Tektonik hub: motor de aplicación Next.js

## Alcance de esta entrega

Las ocho pantallas del producto ahora tienen rutas **React nativas** sobre Next.js App Router, React, TypeScript estricto y Tailwind CSS 4. La aplicación es independiente del prototipo archivado en `Old`, que no se sirve ni se carga durante el build o la ejecución.

El backend de negocio **no está conectado**. Esta fase permite recorrer y validar el producto con fixtures y persistencia local, y separa la interfaz del proveedor de datos para implementar después PostgreSQL/InsForge. No configura proyectos, credenciales, autenticación ni infraestructura de InsForge.

## Ejecutar

Se recomienda **Node.js 22 LTS**. Instalar dependencias desde la raíz:

```powershell
npm ci
npm run dev
```

Abrir `http://127.0.0.1:3000`. Entrar mediante `/login`, seleccionando explícitamente una identidad de demostración. No se aceptan ni verifican contraseñas. El servidor de desarrollo escucha únicamente en loopback.

Producción local:

```powershell
npm run build
npm start
```

`next build --webpack` usa el bundler explícito y prepara páginas optimizadas. La landing se prerenderiza; las vistas de negocio hidratan la sesión y el repositorio en el navegador. No se habilita exportación estática, porque la etapa de backend y los handlers opcionales necesitan un servidor Next.

## Estructura

```text
app\                         App Router: rutas, layouts, estados y handlers
  (platform)\                Grupo protegido para el recorrido demo
  login\                     Entrada con identidad explícita
  api\                       Puente LLM opcional; no es una API de negocio
components\
  ui\                        Button, Badge, Dialog, PageHeading
  auth\                      Guardas locales y estados sin acceso
  providers\                 Repositorio, identidad, idioma, marca y notificaciones
  layout\                    AppShell responsive y portada
  features\                  Catálogo, perfiles, gestión y revisiones
  studio\                    Conversación, versiones, edición y preview
hooks\                       Fronteras de acceso al estado de Tektonik hub y Studio
lib\
  domain\                    Entidades y contratos TypeScript
  data\                      Puerto async, validación y adaptador local
  config\                    Tokens corporativos y aplicación segura de marca
  studio\                    Fachada tipada y persistencia de borradores
    runtime\                 Motores JavaScript propios de la aplicación
  server\                    Transporte LLM exclusivamente local y políticas de entrada
  utils\                     Utilidades compartidas
styles\                      Tokens Tektonik hub, Tailwind y estilos de pantallas
public\                      Distribución pública preparada por el script
scripts\                     Preparación reproducible de recursos
tests\                       Motores actuales, API local y pruebas Next
server\llm.cjs               API Azure opcional, sin servicio estático
Old\                         Archivo histórico, fuera de public y del runtime
database\                    Mapa, diccionario y esquema PostgreSQL propuesto
```

Las fuentes de Google Fonts se declaran en el layout raíz, con fallback de sistema. No se descargan fuentes durante el build. El shell mantiene topbar de 60 px, sidebar de 260 px, scroll independiente, controles de teclado, navegación móvil, diálogos nativos y tokens compartidos con el sistema de diseño Tektonik hub.

## Rutas de la aplicación

| Pantalla | Ruta React |
|---|---|
| Portada | `/` |
| Identidad demo | `/login` |
| Catálogo | `/catalog` |
| Perfil | `/profile` |
| Organización | `/company` |
| Studio | `/studio` |
| Oficina de IA | `/admin` |
| Administración global | `/super-admin` |

`/studio?edit=ID` abre una solicitud de cambios; `/catalog?q=texto` inicializa la búsqueda. `/login?next=...` solo permite destinos internos conocidos. El selector puede preseleccionarse con `role=developer`, `catalog`, `admin` o `superadmin`.

Las URLs antiguas y los archivos de `Old` devuelven 404 en Next. No existen aliases, enlaces ni redirecciones desde la interfaz hacia el prototipo.

`predev` y `prebuild` ejecutan `scripts\sync-public.cjs`: copia exclusivamente los motores de `lib\studio\runtime` a `/engines` y el fixture actual a `/data.json`. Retira las copias públicas antiguas que pudieran quedar de la migración. No lee `Old` ni publica `server`, `.env`, SQL, documentación o customizaciones. Las copias generadas están ignoradas por Git para una futura incorporación del proyecto a control de versiones.

## Puerto de datos

```text
Pantallas / hooks React
          ↓
BLKProvider → BLKRepository (contrato async TypeScript)
                   ↓ ahora
          LocalRepository + validación
                   ↕
          localStorage / sessionStorage
                   ↓ más adelante
          Adaptador autenticado InsForge / PostgreSQL
```

`lib\data\repository.ts` define operaciones y entidades sin acoplar componentes a `window.BLK`, al SDK de un proveedor o a tablas SQL. `createLocalRepository()` carga el fixture, valida relaciones, publica snapshots congelados y emite actualizaciones. La secuencia de escritura es **validar → persistir → publicar**, con errores explícitos de almacenamiento, carga o versiones. `getError()` permite al provider detener una vista que ha perdido un estado local válido.

La identidad se lee de `sessionStorage`; no hay fallback automático a developer. Mutaciones verifican el usuario, rol, organización y estado vigentes. El control local evita errores del recorrido y exposición accidental en la UI; **no es una frontera de seguridad** contra quien controla su navegador.

### Capacidades del recorrido

- Catálogo de aplicaciones aprobadas, búsqueda, filtros, cuadrícula/lista y ficha.
- Perfil del creador: envíos, decisiones por versión y corrección desde Studio.
- Perfil empresarial editable, usuarios y aplicaciones con roles y relaciones locales.
- Oficina de IA: cola de revisión, CRUD, políticas de organización, historial, marca y conexión LLM opcional.
- Administración global: organizaciones, usuarios, planes, políticas, estados y exportación JSON.
- Studio: generación demo, iteración, versiones, código, preview, exportación y envío/corrección de tickets.

Las revisiones exigen una versión esperada. Aprobar una nueva entrega requiere ambos checks manuales; pedir cambios o rechazar requiere motivo. Editar una aplicación aprobada la retira del catálogo hasta una nueva aprobación. Los registros aprobados del fixture no simulan comprobaciones que no se realizaron.

### Almacenamiento y límites

| Clave | Alcance |
|---|---|
| `blkunit:demo:v1` | Entidades, revisión y versión del estado de negocio en este origen |
| `blkunit:demo-session:v1` | Identidad ficticia de esta pestaña |
| `blkunit:lang` | Preferencia de idioma; traducción operativa parcial |
| Claves Studio | Borrador, conversación y versiones por usuario/organización |

Las claves de negocio se mantienen estables para preservar los datos locales ya creados en la aplicación. Distintos puertos o `localhost` frente a `127.0.0.1` no comparten almacenamiento. El evento `storage` actualiza otras pestañas; no crea transacciones ACID. Usar un único operador: escrituras verdaderamente simultáneas pueden sobrescribirse pese a detectar formularios obsoletos.

«Restaurar demo» requiere confirmación y elimina solo las claves locales del negocio/identidad/marca; no borra archivos, preferencias ajenas ni borradores Studio. No usar `localStorage.clear()`. Un JSON corrupto o un fixture incompatible no se reemplaza silenciosamente.

Los adjuntos son **metadatos**, no cargas de binarios. Los borrados del adaptador demo son físicos y pueden borrar relaciones dependientes. El modelo PostgreSQL propone ciclo de vida, versiones y auditoría más sólidos; esa diferencia debe mantenerse explícita al implementar el adaptador remoto.

## Studio: frontera entre React y el documento generado

La interfaz es React. `lib\studio` ofrece una fachada TypeScript para los motores JavaScript puros `lib\studio\runtime\studio-engine.js` y `dashboard-kit.js`. Son fuentes propias actuales; Studio no depende de archivos, estilos, scripts ni almacenes del prototipo archivado.

El iframe solo muestra el **documento generado**. Está aislado con `sandbox="allow-scripts"`, sin `allow-same-origin`, y una CSP offline que bloquea red. Las interacciones de la preview se reinician al montarla de nuevo. No se ejecutan documentos exportados por otras personas, HTML arbitrario del LLM ni código dentro del servidor Next. Esto es aislamiento de prototipo, no garantía de ejecución productiva segura.

Formulario, kanban y calculadora usan acciones locales explícitas de click/Enter y validación de campos, sin necesitar `allow-forms` ni enviar formularios a la red. El renderer compartido incluye la corrección y una regresión en Chromium dentro del mismo sandbox.

Los dashboards se componen desde un catálogo declarativo y datos sintéticos. Azure devuelve JSON validado; el renderer confiable crea el HTML. No se ofrecen conectores corporativos ni generación libre de código. Las versiones conservan procedencia y configuración; fallos y cancelaciones no crean una versión incompleta ni cambian silenciosamente de motor.

## Azure opcional: conservar el MVP local

Está **desactivado por defecto y siempre desactivado en producción**. Para probarlo en la misma máquina:

```powershell
# Terminal 1: servidor local de confianza, claves en memoria
npm run dev:llm

# Terminal 2: Next, con activación explícita solo para esta sesión
$env:BLK_ENABLE_LOCAL_LLM = "true"
$env:BLK_LOCAL_LLM_PORT = "8027"
npm run dev
```

Abrir `/login` como Admin, ir a `/admin` → configuración → LLM Settings. Guardar un endpoint Azure público clásico, deployment, versión de API y clave; después probar conexión. Cambiar a developer en `/login`, abrir `/studio` y seleccionar Azure para dashboards. Las llamadas reales consumen cuota del recurso. Si no se desea Azure, usar exclusivamente el motor demo, sin servidores ni credenciales adicionales.

Los handlers Next permiten únicamente rutas enumeradas (`session`, settings/test/clear y generate), host/origen locales coincidentes, JSON acotado y token CSRF. Solo reenvían al loopback de un puerto válido; no aceptan una URL de destino proporcionada por el cliente, cookies ni encabezados de autorización arbitrarios. Timeout, desconexión, errores y respuestas demasiado grandes se propagan explícitamente, sin log de secretos ni respuestas cacheadas.

El servicio actual `server\llm.cjs` ofrece exclusivamente endpoints API, sin servir páginas ni assets: mantiene claves por organización solo en memoria y restringe Azure a HTTPS `*.openai.azure.com`, cuerpo/respuesta a 250 KB, 60 segundos, una llamada por organización, dos globales y doce por minuto/organización. El puente Next concede 65 segundos para comunicar el resultado del límite del servicio.

**No publicar ni tunelizar estos puertos.** Host/Origin/CSRF no autentican a los procesos locales, y los IDs de organización no aíslan a usuarios reales. El backend productivo debe implementar identidad, autorización, secretos cifrados, costes y controles de proveedor. Esta configuración no se traslada tal cual a InsForge.

## PostgreSQL / InsForge: siguiente etapa

Referencia principal: [mapa PostgreSQL](../database/MAPA_POSTGRESQL.md), [diccionario](../database/DICCIONARIO_DATOS.md) y [esquema inicial](../database/001_initial_schema.sql).

1. Configurar y verificar el proyecto real de InsForge cuando se autorice esa fase. No usar claves de administración en frontend ni variables `NEXT_PUBLIC_*`.
2. Mapear usuarios reales a organizaciones/membresías y roles; reemplazar el selector demo por identidad autenticada.
3. Aplicar migraciones y completar grants/RLS. El esquema actual deniega por defecto; no habilitar acceso global para hacer funcionar la UI.
4. Implementar `BLKRepository` remoto: entidades frontend y tablas no necesitan ser 1:1. Organizaciones, versiones, tickets, revisiones y métricas deben traducirse explícitamente.
5. Ejecutar publicación/revisión y comprobaciones de versión dentro de transacciones/RPC de servidor; sustituir timestamps/counters locales por valores mantenidos por PostgreSQL.
6. Integrar archivos con Storage, límites y políticas; definir borrado lógico/retención y auditoría inmutable.
7. Validar aislamiento multiempresa y concurrencia reales antes de retirar avisos demo, desplegar o aceptar datos sensibles.

## Validación reproducible

```powershell
npm run typecheck
npm run lint
npm run test:next
npm run test:next:llm
npm test
npm run build
npm run test:next:browser
```

La suite actual valida los motores, su sandbox y el servicio API local. Los tests Next cubren el puerto de datos, Studio, tokens, rutas sin aliases, ausencia de enlaces históricos y políticas del puente. El recorrido HTTP verifica que todas las URLs antiguas y `Old` son inaccesibles en Next. El archivo histórico conserva su suite por separado; no es una dependencia de las pruebas actuales. `test:next:llm` inicia servidores propios y comprueba HTTP real Next → servicio local → Azure simulado: configuración, generación, iteración, rechazo de JSON ejecutable, origen/CSRF, límites, cancelación y eliminación de claves. No requiere credenciales reales. El recorrido Playwright utiliza un build productivo, servidor loopback y perfiles independientes; no modifica la sesión habitual ni llama a Azure real. Si no hay navegador instalado: `npx playwright install chromium`. El mapa SQL tiene su propio validador embebido, documentado en `database`.

Los checks automatizados no son una auditoría de accesibilidad, certificación, prueba de carga ni un pentest. El entorno actual no tiene Git, CI ni despliegue configurado: deben añadirse cuando se prepare la publicación, sin presentar esta entrega frontend como una plataforma productiva ya operativa.
