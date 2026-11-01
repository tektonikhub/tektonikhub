# Tektonik hub — archivo del prototipo HTML

Esta carpeta `Old` conserva los ocho HTML originales, sus assets, fixture, servidor local, pruebas y contrato de dashboards. Es un archivo local independiente: no se publica desde la aplicación nueva y no requiere su compilación ni sus rutas.

**Solo demostración, sin autenticación ni autorización reales.** Los roles e identidades son ficticios; los datos de negocio permanecen en `localStorage` y la identidad por pestaña en `sessionStorage`. No introducir datos sensibles, documentación corporativa ni credenciales de usuarios. No publicar ni tunelizar el servidor. Las métricas, certificaciones e integraciones mencionadas son ejemplos, no garantías implementadas.

## Ejecutar desde Old

Node.js **20.18 o superior** (recomendado 22 LTS). Desde PowerShell:

```powershell
Set-Location "C:\Users\Claudia\Desktop\Mis Webs\blk\Old"
npm run dev
```

Abrir `http://127.0.0.1:8027/index.html` o `http://127.0.0.1:8027/login.html`. Detener con `Ctrl+C`. No hace falta configurar Azure para usar el modo demo.

Para validar el archivo desde esa misma carpeta:

```powershell
npm test
npm run test:browser
```

Las pruebas usan las dependencias ya instaladas en la carpeta padre; no se necesita instalar paquetes ni generar otro lockfile para este archivo. Playwright y un navegador disponible son necesarios para las comprobaciones de navegador (incluida la prueba de runtime del dashboard). Los runners crean y detienen sus propios servidores y perfiles aislados.

## Prototipo HTML original

### Tektonik hub Studio: creación conversacional del prototipo

`create-app.html` sustituye el wizard por un estudio con conversación a la izquierda y preview HTML en el centro. Mantiene la marca Tektonik hub y usa JavaScript nativo.

- Describe una herramienta o elige una sugerencia: dashboard, calculadora de ahorro, formulario o tablero de tareas.
- Dos motores explícitos: **demo local**, sin IA, y **Azure OpenAI**, composición real de dashboards con JSON validado. La IA elige componentes y configura datos ficticios; el renderer de Tektonik hub crea el HTML. No ejecuta HTML/JS arbitrario del modelo, no utiliza computer-use ni es una implementación completa de Lovable. Calculadoras, formularios y kanban siguen disponibles solo en demo.
- Puedes iterar con «modo oscuro», «color violeta», «añade un gráfico», «añade un buscador» o «diseño compacto». Cambiar de tipo requiere una petición explícita, según las reglas del motor.
- El panel Código muestra progresivamente el documento ya generado: no es streaming de tokens del LLM. Preview solo monta documentos completos, dentro de un `iframe` sin acceso al origen del host y con una CSP que bloquea conexiones de red. Es aislamiento de prototipo, no una certificación de seguridad.
- Las herramientas generadas usan datos ficticios y permiten interacciones locales. Reiniciar la preview restaura esos datos; sus interacciones no se guardan en el borrador.
- Se conservan las últimas 8 versiones y 40 mensajes por usuario/organización de demostración en `localStorage`. Seleccionar una versión anterior y pedir cambios crea una versión nueva. Detener la generación conserva la última versión completa.
- «Exportar HTML» descarga `index.html`; «Enviar a IT» crea el ticket existente y guarda el documento en `generatedHtml`. El admin ve el envío y sus metadatos en la cola actual; no se añade un visor de código al admin. No hay PR ni despliegue automático. Un envío pendiente no puede reenviarse desde el mismo borrador; los cambios solicitados se abren desde el perfil y conservan su ticket.
- El login y los roles siguen siendo de demostración. No introducir datos sensibles. Si falla el almacenamiento, el borrador puede seguir en memoria, pero debe exportarse antes de salir.

Archivos: `assets/studio.css`, `assets/js/studio.js` (interfaz, actividad, versiones y revisión), `assets/js/studio-engine.js` (demo general), `assets/js/dashboard-kit.js` (catálogo, plantillas, validación y renderer), `assets/js/llm-client.js` y `server/local.cjs` (proxy Azure). La procedencia del motor se conserva en las versiones, exportaciones y envíos a IT.

Validación: `npm test` para motores, kit, almacén y servidor (incluye una prueba de runtime del dashboard en Chromium); `npm run test:studio` para el recorrido en Chromium con Playwright (servidor temporal propio). Esta última requiere el navegador de Playwright instalado.

## Azure OpenAI: MVP local

El servidor del **prototipo HTML** requiere Node.js 20.18 o superior, sin dependencias de runtime propias ni despliegue:

```powershell
npm run dev
```

1. Abrir `http://127.0.0.1:8027/login.html` y seleccionar **Admin** de demo.
2. En `admin.html`, abrir **Configuración org → LLM Settings**.
3. Introducir endpoint base `https://TU-RECURSO.openai.azure.com`, **nombre del deployment**, API version (por defecto `2024-10-21`) y API key. No pegar la URL completa de Chat Completions. Este MVP admite el dominio clásico de Azure público, no endpoints Foundry alternativos, proxies ni nubes soberanas.
4. Guardar y pulsar **Probar conexión guardada**. Requiere un deployment compatible con Chat Completions, `response_format: json_object` y `max_tokens`; la prueba consume cuota. Modelos o versiones incompatibles devolverán un error explícito.
5. Volver al rol **Developer**, abrir `create-app.html` en el mismo origen y seleccionar **Azure OpenAI · dashboards**. Si ya estaba abierto, actualizar la conexión con el botón junto al selector. Pedir un dashboard de ventas, operaciones o proyectos e iterar conversando.

Las claves están **solo en memoria del proceso Node**, separadas por ID de organización. Nunca se escriben en archivos, datos de demo, localStorage, HTML generado, logs o respuestas. La clave transita por el formulario y el POST local; el campo se vacía al guardar. Un campo vacío al actualizar conserva la clave ya configurada; «Eliminar credenciales» la borra. Reiniciar Node borra todas las conexiones guardadas. Endpoint y deployment son visibles; la clave no se recupera.

El servidor escucha **únicamente en 127.0.0.1**. Comprueba Host/Origin/CSRF, no habilita CORS y restringe archivos públicos y endpoints de Azure. Límites de prototipo: solicitud/respuesta de 250 KB, 60 s por petición, una generación/prueba por organización, dos simultáneas globales y 12 peticiones/minuto por organización. Cancelar aborta la llamada pendiente; Azure puede facturar tokens ya procesados. Los fallos no se sustituyen silenciosamente por demo ni crean versiones incompletas.

**Solo para una máquina y operadores de confianza.** Los roles del navegador no son autorización de servidor y los IDs de organizaciones no aíslan usuarios reales. Cualquier usuario/proceso de esa máquina con acceso al servicio puede utilizar sus APIs. No usar túneles, publicar el puerto ni compartir este servidor; producción requiere autenticación, autorización multiempresa, cifrado/persistencia de secretos y control de costes. No hay garantías de zero-retention: Azure procesa prompts, configuraciones previas y datos de ejemplo conforme al recurso contratado. Las pruebas usan un mock local de Azure; la conexión real debe verificarse con tu deployment y credenciales.

### Kit declarativo de dashboards

- Componentes: métricas (suma/media/recuento), tablas ordenables y paginadas, gráficos SVG de barras/líneas/donut, filtros de fecha/categoría/estado/búsqueda y bloques de texto.
- Una misma colección filtrada actualiza métricas, gráficos y tabla; incluye estados vacíos, controles accesibles y diseño responsive.
- Plantillas sintéticas: **ventas**, **operaciones** y **proyectos**. Hasta 200 filas y 16 componentes; no son conectores corporativos.
- Skill de composición: `.agents/skills/dashboard-builder/SKILL.md`. El servidor la incorpora con el contexto del kit a cada llamada.
- Flujo: petición + configuración anterior + catálogo/schema → Azure → JSON → validación estricta → renderer confiable → HTML offline aislado. Propiedades desconocidas, código ejecutable y estructuras inválidas se rechazan; no se realiza una reparación automática que consuma otra llamada.
- El HTML contiene su configuración como JSON inerte para conservar componentes y datos al corregir un ticket. Las interacciones del dashboard siguen siendo temporales, sin base de datos.

Validación: `npm test`, `npm run test:llm` (Admin → Azure simulado → dashboard → filtros/iteración/revisión), `npm run test:studio` y `node tests\browser-demo.cjs --core`. Los runners de navegador usan perfiles y servidores temporales propios y no llaman a Azure real.

## Inicio rápido (solo demo estática)

No requiere instalación de dependencias ni compilación. Utiliza HTML, CSS y JavaScript nativos, con fuentes de Google Fonts y gráficos SVG embebidos.

Desde PowerShell, dentro de `Old`, ejecutar:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Abrir [la landing](http://127.0.0.1:8000/index.html) o [el acceso de demostración](http://127.0.0.1:8000/login.html). Detener el servidor con `Ctrl+C`. Si Python no está disponible, utilizar un servidor estático local equivalente; no es una dependencia de la aplicación.

**HTTP es obligatorio:** la carga de `data.json` mediante `fetch` no funciona de forma fiable con `file://`. Mantener el mismo navegador y origen durante la demo: `localhost` y `127.0.0.1`, o distintos puertos, no comparten `localStorage`. Google Fonts requiere conexión; existen fuentes de respaldo. Si falla la carga, aparece un mensaje con acciones de reintento y reinicio.

## Inventario y funcionamiento real

| Archivo | Qué se puede mostrar | Limitación actual |
|---|---|---|
| [index.html](index.html) | Landing ES/EN; contenido y ejemplos desde JSON; acceso al portal. | Mensajes comerciales y ROI son ilustrativos, no resultados medidos. |
| [login.html](login.html) | Selector de cuatro roles ficticios con identidad por pestaña. | Sin contraseña, OTP ni SSO reales; nunca introducir credenciales. |
| [app-catalog.html](app-catalog.html) | Apps aprobadas, filtros, búsqueda, grid/lista y ficha; nuevas aprobaciones aparecen y persisten. | Sandbox informa de que no ejecuta código. Ahorros y valoraciones son fixtures. |
| [create-app.html](create-app.html) | Tektonik hub Studio: chat, generación local, preview interactiva, código, versiones y envío con HTML a revisión; corrección mediante `?edit=ID`. | Azure solo con servidor Node y configuración; roles, persistencia y tickets de demo en el navegador. Sin publicación ni computer-use. |
| [admin.html](admin.html) | Oficina de IA: CRUD de aplicaciones en todos los estados y políticas de la organización; búsqueda, filtros, detalles/historial y aprobación/rechazo/cambios; editor de marca y LLM Settings. | Persistencia y permisos de demo en el navegador; políticas informativas, sin escáner DLP, certificado real ni email. |
| [super-admin.html](super-admin.html) | CRUD de organizaciones, usuarios, planes y políticas; aprobación/suspensión/reactivación, búsquedas y exportación JSON. Sin actividad reciente ni sección Sistema. | Persistencia en el navegador; políticas informativas, roles y restricciones locales, sin autorización real. |
| [company-profile.html](company-profile.html) | Perfil editable, CRUD de usuarios y aplicaciones, revisión, búsqueda y filtros; vista pública de apps aprobadas. | Cambios locales desde JSON; permisos de demo, sin telemetría ni integraciones externas. |
| [profile.html](profile.html) | Herramientas, contenido ES/EN y «Mis envíos»: estado, motivos, historial y corrección. | Prompts y prueba de sandbox son demostraciones, no ejecución aislada. |

Este inventario describe únicamente el archivo local del prototipo. No tiene despliegue ni repositorio Git propios.

## Oficina de IA: gobernanza y revisión

Desde la navegación del catálogo o del administrador, **Oficina de IA** abre `admin.html#view-office`.

- Con el rol Admin de demo, permite crear, consultar, editar y eliminar aplicaciones de la organización, con búsqueda y filtros por los cuatro estados. Las altas y ediciones quedan pendientes; editar una aprobada la retira del catálogo hasta su nueva aprobación. Conserva ticket, adjuntos, HTML generado e historial de decisiones.
- Las aplicaciones pendientes admiten aprobación con las dos comprobaciones manuales, rechazo con motivo y solicitud de cambios. «Detalles e historial» muestra notas de riesgos, metadatos y decisiones por versión.
- Las políticas de gobernanza tienen nombre, descripción y estado habilitado; su CRUD queda limitado a la organización activa. Las políticas globales del Super Admin se muestran como solo lectura, sin modificar su alcance.
- Eliminar requiere confirmación; eliminar una aplicación también borra sus revisiones y eventos vinculados. Las versiones detectan formularios obsoletos y los errores de almacenamiento no se presentan como guardados exitosos.
- No añade backend ni controles de cumplimiento automáticos: todo permanece en el almacén local compartido.

Validación: `npm run test:admin` ejecuta el recorrido de CRUD, revisión, historial, persistencia, navegación, roles, conflictos entre pestañas, fallos de almacenamiento y diálogo móvil con un servidor temporal y un perfil de navegador aislado.

## Arquitectura del prototipo HTML

```text
data.json → assets\js\data-store.js (window.BLK) → ocho HTML
                         ↕
             localStorage + sessionStorage
```

- CSS, estructura HTML, lógica de interfaz y filtros permanecen en las pantallas; no son columnas de una futura base de datos.
- `BLK.ready` carga una vez el JSON y espera el DOM; todas las vistas leen el mismo snapshot.
- Escrituras: validar → persistir → notificar. Una cuota insuficiente no se presenta como un guardado exitoso.
- El evento `storage` sincroniza cambios de negocio y marca entre pestañas del mismo origen. Cada pestaña conserva su propio rol de demo.
- `localStorage` no ofrece transacciones de base de datos entre pestañas: escrituras verdaderamente simultáneas pueden sobrescribirse. El control de estado/versión evita revisiones obsoletas en el recorrido normal, pero no sustituye la concurrencia de servidor. Usar un único operador en la demo.
- No existe API de negocio: sustituir posteriormente los métodos de `BLK` por peticiones autenticadas y validación de servidor. El JSON ofrece entidades e IDs, no reemplaza una base de datos.

### Modelo y edición de fixtures

| Colección | Contenido |
|---|---|
| `organizations` | Identidad, plan, estado, miembros, `adminId`, marca y `profile` opcional (bio, título y descripción del banner). |
| `users` | Nombre, email ficticio, departamento, `orgId` y rol. |
| `apps` | `orgId`, `authorId`, categoría, ticket, versión, descripción, metadatos, métricas y `reviewStatus`. |
| `reviews` / `events` | Decisión/motivo/versión/revisor y cambios locales; no auditoría inmutable. |
| `plans` / `policies` | Planes editables (nombre/precio) y políticas informativas (nombre/descripción/habilitada); políticas globales sin `orgId` y políticas de Oficina de IA con `orgId`, `version` y fechas. Cambios persistentes en el navegador. |
| `categories` / `config` | Catálogos, identidades de demo, límites y tokens/presets de marca. |
| `content` | Textos, traducciones, bloques y ejemplos de las ocho pantallas. No almacena páginas HTML completas. |

El seed incluye **6 organizaciones, 21 usuarios, 13 apps aprobadas y 3 pendientes**. Las otras organizaciones ya no anuncian apps inexistentes en el dataset. `maturity` (`approved`, `beta`, `new`) es una etiqueta de catálogo distinta de `reviewStatus`.

Editar `data.json`, conservar IDs únicos y relaciones, y reiniciar la demo para descartar los cambios guardados. Incrementar `datasetVersion` cuando cambie el escenario de fixtures: el cargador pedirá un reinicio en vez de mezclar estados incompatibles. Cambios de esquema requieren una migración o una nueva clave de almacenamiento.

Los textos de las cinco pantallas operativas se vinculan con comentarios `blk:text:clave` o atributos `data-blk-*` a `content.<página>.texts`; landing y perfiles usan bloques/traducciones con nombres. Estos bindings mantienen el markup y el diseño, aunque editar una nueva etiqueta requiere añadir su entrada JSON correspondiente.

### Persistencia existente

| Clave | Escritura | Lectura | Alcance |
|---|---|---|---|
| `blkunit:demo:v1` | Métodos de `BLK` | Ocho páginas. | Entidades mutables, versión y revisión del estado. Solo este origen/navegador. |
| `blkunit:demo-session:v1` (`sessionStorage`) | Selector de rol | Ocho páginas de esa pestaña. | Identidad ficticia; no sesión autenticada. |
| `blkunit:lang` | Landing y perfiles. | Esas páginas. | Preferencia ES/EN; traducción operativa todavía parcial. |

La marca se guarda en la organización del estado común. La antigua clave `blk_viarapida_css_tokens` deja de ser la fuente de marca y se elimina al reiniciar.

Los tokens corporativos de referencia incluyen `--accent: #FEFF44`, `--bg: #EFEFEB`, `--card: #FFFFFF`, Barlow, DM Sans y JetBrains Mono. Admin y catálogo emplean un App Shell con barra superior y sidebar. Estos estilos se conservan en los HTML y assets archivados.

El catálogo prioriza descripción, autor, área, estado y acciones. No muestra métricas de ahorro/empleados, stack tecnológico ni sellos o afirmaciones de certificación, DLP o CISO; conserva el total de apps y la valoración de la ficha. Los datos compartidos se mantienen para las demás pantallas. `content.catalog.appDescriptions` permite adaptar descripciones del catálogo sin alterar las entidades guardadas; las aplicaciones editadas (versión > 1) muestran su descripción guardada, no el texto inicial. Validación específica: `node tests\browser-demo.cjs --catalog-only`.

## Flujo objetivo frente al flujo actual

**Flujo implementado en esta demo local:**

```text
Developer registra app → IT recibe el mismo ticket → revisión con motivo
  ├─ cambios solicitados → autor corrige y reenvía
  ├─ rechazo → autor consulta el motivo
  └─ aprobación → app visible en catálogo → empleado utiliza la herramienta
```

`pending_review` pasa a `approved`, `changes_requested` o `rejected`. Los cambios solicitados permiten editar/re-enviar desde el perfil: conserva ID/ticket e incrementa `version`. Las decisiones comprueban estado y versión para evitar revisiones duplicadas u obsoletas. Solo `approved` aparece en catálogo. La aprobación **no** despliega código ni emite una certificación real.

## Diagnóstico para la demo

**Fortalezas:** identidad visual definida, roles reconocibles, variedad de pantallas y buena base de catálogo / estudio conversacional / revisión.

**Pendientes para validar el negocio:**

1. Añadir una herramienta útil con datos controlados y resultados verificables; ahora sandbox no ejecuta código.
2. Ensayar el recorrido con un posible cliente, medir interés, tiempo de revisión y disposición a pagar. Las métricas iniciales son ejemplos, no evidencia comercial.
3. Pulir accesibilidad, navegación por teclado, foco de modales, responsive y traducciones; no se ha completado una auditoría visual o de accesibilidad.
4. Unificar mensajes comerciales, SLA y contenido de presentación que todavía procede del prototipo.
5. Para colaboración real: backend, identidad, permisos por organización/rol, archivos y auditoría de servidor. Los controles locales pueden alterarse con las herramientas del navegador.

Los entregables de producto pendientes quedan fuera del alcance de este archivo.

## Qué se puede demostrar hoy

1. Abrir landing/login y entrar como **developer**. Publicar una app con descripción y datos ficticios.
2. Cambiar al rol **admin** desde el acceso de demo. Localizar el mismo ticket y solicitar cambios con motivo.
3. Volver como developer al perfil: consultar motivo, corregir y reenviar.
4. Como admin, aprobar confirmando las dos comprobaciones **manuales de demo**.
5. Abrir catálogo, buscar la nueva app y mostrar su ficha. Recargar: conserva el registro. Sandbox explicará que no ejecuta código.
6. Opcional: guardar marca y abrir otra pestaña; como superadmin, gestionar organizaciones, usuarios, planes y políticas.

### CRUD del perfil de empresa

En `company-profile.html`, entrar como **admin** o **superadmin** para ver los controles de gestión. Permite editar nombre, dominio, descripción y textos del banner; añadir, editar y eliminar usuarios y aplicaciones; buscar registros y filtrar aplicaciones por estado. Los textos personalizados son comunes a ES/EN y se muestran como texto, no HTML. «Restablecer textos» elimina la personalización del perfil sin borrar la organización ni sus relaciones; altas/bajas de organizaciones siguen en superadmin.

El admin gestiona creadores y empleados únicamente de su empresa, sin otorgar roles administrativos. Se conservan las protecciones de identidades, administrador principal y usuarios con apps/revisiones. Las apps nuevas o editadas quedan pendientes; «Aprobar» usa el flujo compartido de revisión. Editar conserva ID/ticket e incrementa versión, retira la aprobación anterior y mantiene el historial. Eliminar una app borra sus revisiones/eventos relacionados. Visitantes ven solo apps aprobadas y sus autores.

Los datos parten de `data.json`; los cambios persisten en el navegador y se sincronizan entre pestañas, sin modificar el JSON original. Las métricas de apps aprobadas se recalculan desde el estado compartido. Prueba específica: `npm run test:company` (formularios reales, revisión, persistencia, sincronización, filtros, idiomas y móvil).

### CRUD del superadmin

Entrar con el rol **superadmin** desde `login.html`. Todas las secciones restantes del menú permiten consultar, crear, editar y eliminar registros. Organizaciones pendientes pueden aprobarse; las suspendidas pueden reactivarse. La ficha permite cambiar nombre, dominio, plan, estado, miembros y administrador; el acceso al panel selecciona una identidad admin de esa organización.

Los cambios parten de `data.json`, persisten en `localStorage` y se sincronizan entre pestañas del mismo origen. No se escribe el archivo original. «Exportar» descarga `tektonik-hub-data.json` con el snapshot completo, incluidos los cambios; los estados locales anteriores conservan sus entidades al incorporar planes/políticas editables.

Eliminar una organización requiere confirmación y elimina sus usuarios, aplicaciones, revisiones y eventos relacionados. La organización predeterminada, la de la sesión y las identidades de demo están protegidas. No puede eliminarse un administrador asignado ni un usuario con apps/revisiones; tampoco un plan asignado. Cambiar de organización a un usuario con apps se bloquea para conservar las relaciones. Las políticas son únicamente configuración informativa, no reglas ejecutadas.

Prueba específica: `node tests\super-admin-browser.cjs`. Verifica CRUD con formularios reales, filtros, suspensión/reactivación, recarga, sincronización entre pestañas, exportación JSON y carga móvil.

El rol de cada pestaña es independiente. Publicar requiere developer; revisar requiere admin/superadmin; gestionar organizaciones requiere superadmin. Las restricciones son únicamente para ordenar el recorrido, no protegen datos reales.

**Reinicio:** usar «Reiniciar» en el control de demo. Restaura fixtures y elimina solo las claves de estado/sesión/marca de BLK, conservando preferencias de idioma y claves ajenas. También se puede ejecutar, tras `await BLK.ready`:

```javascript
BLK.reset();
location.reload();
```

No usar `localStorage.clear()`. Recargar por sí solo **ya no** borra envíos ni decisiones. Un fallo de cuota, JSON inválido o versión incompatible produce un error; no se reinicia silenciosamente.

## Plan de mejora

El backlog de producto no forma parte de este archivo local.

**Siguiente prioridad:** incorporar una herramienta de ejemplo funcional y ensayar el recorrido con potenciales clientes. La gobernanza local está conectada; autenticación real, aislamiento multiempresa y ejecución arbitraria pertenecen a una fase posterior, no a una simulación presentada como producción.

## Comprobaciones realizadas

Pruebas del modelo con Node: relaciones, estados, validación, duplicados, reenvíos, roles de demo, cuota, recarga, eventos entre pestañas, marca, suspensión y reinicio selectivo. Pruebas estáticas de scripts, bindings y enlaces de los ocho HTML.

Para repetirlas desde PowerShell:

```powershell
npm test
npm run test:browser
```

Solo las pruebas de navegador requieren Playwright. El runner usa Edge o Chrome instalados en Windows; se puede definir `$env:BLK_BROWSER_PATH` con la ruta del ejecutable. En otro entorno sin navegador instalado, ejecutar `npx playwright install chromium`.

El runner de navegador crea y detiene su propio servidor local y utiliza un perfil temporal independiente: no modifica los datos de tu navegador habitual. Comprueba el recorrido conectado, recarga, sincronización, texto con caracteres especiales, organizaciones, recuperación de carga y reinicio. Estas pruebas no sustituyen una auditoría de seguridad, accesibilidad o responsive completa.

