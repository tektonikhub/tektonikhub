# Tektonik hub

Plataforma para crear, revisar y distribuir micro-aplicaciones con IA dentro de una organización, con supervisión de IT.

**Aplicación:** [https://vxpd968k.insforge.site](https://vxpd968k.insforge.site)

**Acceso:** [https://vxpd968k.insforge.site/login](https://vxpd968k.insforge.site/login)

## Aplicación

Tektonik hub utiliza **Next.js App Router, React, TypeScript estricto y Tailwind CSS 4**. La identidad y los datos de negocio se gestionan en **InsForge / PostgreSQL**. El acceso requiere una cuenta autorizada y activada; la empresa y el rol se asignan en el servidor, no en el formulario.

El flujo de trabajo comprende creación, envío a revisión, solicitud de cambios, reenvío, aprobación y publicación en el catálogo. Incluye gestión de organizaciones, usuarios, planes, políticas y marca. Las revisiones son confirmaciones manuales: no acreditan certificaciones, auditorías automáticas ni integraciones corporativas. Las métricas y precios son informativos; no hay facturación ni cobros integrados.

| Pantalla | Ruta |
|---|---|
| Portada ES/EN | `/` |
| Acceso | `/login` |
| Activación y contraseña | `/reset-password` |
| Catálogo aprobado | `/catalog` |
| Mi Flow y mini apps personales | `/mi-flow` |
| Perfil y envíos | `/profile` |
| Organización y gestión | `/company` |
| Creación conversacional | `/studio` |
| Subir y previsualizar HTML / JSON | `/studio/upload` |
| Oficina de IA | `/admin` |
| Administración global | `/super-admin` |

## Acceso y activación

En `/login`, introducir usuario o correo y contraseña. El formulario ofrece recuperación y activación de cuenta. Tras autenticarse, cada persona accede únicamente a las rutas permitidas para su rol.

Studio está disponible para `developer`, `admin` y `superadmin`, tanto desde la navegación como desde el perfil. Estos roles pueden crear, enviar y corregir sus propias aplicaciones de su organización; el rol `catalog` no tiene acceso. Se mantienen la revisión de IT y los controles de autor, organización, estado y versión.

Si todavía no existe una cuenta inicial, el operador autorizado debe reservar su propia cuenta de superadministrador mediante:

```sh
npm run accounts:bootstrap -- "correo-del-responsable@empresa.com" "administrador"
```

La operación crea exclusivamente esa cuenta y su organización/plan iniciales, y solicita un correo de verificación. No genera ni comparte una contraseña provisional.

Abrir el enlace de verificación recibido. En `/reset-password?activate=1`, solicitar el enlace de contraseña con el mismo usuario o correo; abrirlo y elegir una contraseña de al menos 15 caracteres. Las siguientes cuentas se invitan desde Usuarios, con su empresa y permisos asignados.

Si el envío falla después de reservar la cuenta, reenviar sin crear otra:

```sh
npm run accounts:bootstrap -- "correo-del-responsable@empresa.com" "administrador" --resend
```

Los enlaces utilizan `APP_URL` o `NEXT_PUBLIC_APP_URL`, y sus destinos deben estar autorizados en InsForge.

## Arquitectura y datos

**Mi Flow** reúne las mini apps que cada usuario añade desde el catálogo de su organización. En las fichas, «Añadir» aparece entre «Detalles» y «Acceder» y pasa a «Añadida» al guardar, sin duplicados. La selección y los favoritos se guardan en InsForge, no en el navegador, y son privados incluso frente a otros administradores.

El Flowverse ofrece vistas órbita y tarjetas, navegación por flechas o arrastre, búsqueda y colecciones por área. Se pueden marcar favoritos, consultar detalles y retirar mini apps sin eliminar las aplicaciones del catálogo. Las órbitas muestran hasta ocho mini apps a la vez; las flechas recorren toda la selección. Solo aparecen apps aprobadas de la organización activa del usuario: si se archivan, vuelven a revisión o la organización deja de estar activa, dejan de mostrarse. No se incluyen agentes, creación de flows, workflows ni automatizaciones del prototipo.

«Acceder», tanto en el catálogo como en Mi Flow y sus diálogos de detalles, abre el HTML guardado de la versión aprobada ocupando todo el espacio disponible bajo el header y junto al menú. No incluye el chatbot ni los controles de edición de Studio. «Volver» regresa a la pantalla de origen; la URL conserva los parámetros de búsqueda y permite recargar la aplicación. El HTML se recupera con la sesión verificada, sin descargar todas las fuentes en el catálogo ni leer borradores del navegador. Se utiliza el mismo iframe aislado de Studio: los scripts internos pueden funcionar, pero no tienen acceso a la sesión del hub ni a la red. No se despliega un servidor por aplicación. Si no hay HTML guardado o la app deja de estar autorizada, se muestra el error sin sustituirla por una demo.

```text
React / hooks → BLKProvider → RemoteBLKRepository → API Next.js
                                                    ↓
                               Cookies SSR + tk_identity / tk_workspace
                                                    ↓
                                      PostgreSQL / InsForge + RLS
```

Las rutas protegidas verifican identidad y rol en el servidor. Las operaciones de negocio se autorizan mediante PostgreSQL, con aislamiento por organización, restricciones de relaciones y control de versiones concurrentes. Archivar conserva el historial de revisiones y eventos.

Studio guarda el HTML enviado en `app_versions`. Para corregir una entrega, `/api/studio/source` recupera exclusivamente la versión autorizada, comprobando autor, empresa y estado. La sincronización cloud de conversaciones, la carga de otros tipos de binarios y un sandbox de ejecución de servidor siguen pendientes. Los documentos generados se previsualizan en un iframe aislado; esto no constituye una certificación de seguridad.

En `/studio`, la descripción escrita en el chatbot inicia la creación, sin elegir un proyecto de InsForge, un proveedor o una plantilla obligatoria. No se muestra ni se genera un registro de actividad del proyecto; se mantienen la conversación, las versiones y los borradores existentes. Las nuevas generaciones requieren el LLM configurado para la organización: no hay generación demo ni sustitución automática por plantillas locales. El servicio actual solo admite dashboards declarativos con datos sintéticos.

La interfaz se centra en conversación y vista previa, sin encabezado grande ni panel inferior de archivos. Una barra compacta arriba a la derecha reúne el estado del borrador, el indicador LLM, el reinicio y «Añadir ficheros». El indicador solo aparece verde tras confirmar la configuración de la organización; el texto al pasar el ratón o enfocar explica el estado, y pulsarlo reintenta la comprobación. También se actualiza al volver a la ventana. «Añadir ficheros» abre `/studio/upload`, un espacio separado para subir aplicaciones portables. Las referencias antiguas junto al chat siguen siendo metadatos y no se convierten automáticamente en assets. Las opciones de preview, copia y exportación HTML se agrupan en «Más opciones»; no hay exportación habitual de borradores JSON. La recuperación del original se conserva únicamente ante fallos de almacenamiento.

El proyecto cloud **`tektonik-hub`** está en **EU Central (`eu-central`)**. Su backend es `https://vxpd968k.eu-central.insforge.app`; se administra desde el [panel de InsForge](https://insforge.dev/dashboard/project/621de563-b6b4-4041-b541-579e6128a916).

El esquema base es `migrations/20261101075915_identity-workspace.sql`, con 15 tablas de negocio, RPC autorizados y RLS. `migrations/20261101180821_studio-admin-access.sql` amplía los permisos de envío y corrección a los administradores sin modificar el resto de los controles del RPC. El diseño histórico de `database` no debe aplicarse sobre estas migraciones.

`migrations/20261101182647_mi-flow.sql` añade `user_flow_apps`, lectura privada con RLS y RPC que obtienen la identidad del servidor y comprueban organización y aprobación. No cambia los datos de las tablas existentes ni importa apps del HTML de referencia.

`migrations/20261101194802_catalog-app-access.sql` permite leer la versión actual de las apps aprobadas de la organización activa para «Acceder». Conserva los permisos de historial de creadores y administradores; no publica versiones anteriores ni concede escritura al catálogo.

## Aplicaciones HTML / JSON portables

Desde **Studio → Añadir ficheros**, arrastra ficheros o selecciónalos: exactamente un `.html` y, opcionalmente, sus `.json`. No se admiten otros tipos, carpetas ni nombres duplicados. Máximo: 10 ficheros, **2 MB por fichero HTML o JSON (2.000.000 bytes UTF-8)** y conjunto de 25 MiB. Ya no existe un límite de caracteres para el HTML. Los JSON de versiones enviadas anteriormente conservan su compatibilidad de lectura (hasta 5 MiB); para nuevos envíos o correcciones deben respetar los 2 MB. Usa nombres simples de hasta 120 caracteres (letras ASCII, números, espacios, guiones, puntos y guiones bajos), sin rutas ni `..`.

La vista previa ofrece escritorio, móvil, reinicio y código. Los scripts internos conservan `fetch('./datos.json')`, `fetch(new Request('./datos.json'))` y XHR local. También funcionan los selectores de fichero y `FileReader` para importar un JSON del equipo y las descargas `Blob` para guardar resultados. `window.TektonikFiles.list()`, `.read(nombre)` y `.exportJSON(nombre, valor)` ofrecen acceso explícito al bundle. Bibliotecas, imágenes, fuentes o APIs externas no se cargan: las dependencias deben estar integradas en el HTML. No se admiten módulos externos ni servidores por miniapp.

El iframe usa `allow-scripts allow-downloads`, nunca `allow-same-origin`: no tiene acceso a las cookies del hub. El almacenamiento local de la miniapp es temporal en memoria y se reinicia con el preview; **los cambios en los JSON no se sincronizan automáticamente con InsForge**. Guarda una descarga para conservar resultados. La previsualización ejecuta el mismo runtime que el catálogo.

Al enviar, se reserva un manifiesto pequeño y los originales se suben directamente con la sesión del usuario al bucket **privado** `portable-apps`, evitando el límite de cuerpo del hosting. El servidor descarga y valida el contenido antes de registrar atómicamente la aplicación y sus assets versionados. Las claves están ligadas a la reserva, al autor y a la organización, y los originales quedan inmutables desde su carga (sin sobrescritura ni eliminación desde cuentas de aplicación). Las cargas incompletas siguen privadas y no publicadas; su eliminación es mantenimiento del operador sobre reservas caducadas, nunca de bundles enviados. Las reservas caducan en una hora y se limitan a 30 por cuenta y día; un fallo no publica una app incompleta. Ante una respuesta incierta, consulta Perfil antes de repetir.

Admin puede abrir la previsualización desde la revisión; la aprobación incorpora inmediatamente esa versión al catálogo y Mi Flow de la organización. «Solicitar cambios» permite al autor recuperar el bundle, sustituir ficheros y reenviar una nueva versión. Los cambios administrativos de metadatos que conservan el HTML mantienen sus JSON. El rol `catalog` no puede subir ni revisar, y solo descarga assets de la versión actualmente aprobada. Archivar o retirar la aprobación revoca ese acceso.

Las migraciones `20261107072737_portable-app-assets.sql`, `20261107073123_portable-upload-finalization.sql`, `20261107073708_portable-storage-finalize-privileges.sql`, `20261107073757_portable-storage-insert-only.sql` y `20261107075200_portable-html-storage-mime.sql` añaden reservas, referencias versionadas, RPC y políticas RLS restrictivas sobre `storage.objects`. La migración `20261107080948_portable-file-size-limit.sql` unifica las nuevas reservas a 2.000.000 bytes por fichero y aplica el mismo límite UTF-8 al HTML versionado. InsForge normaliza el MIME de HTML a `application/octet-stream`; solo se acepta esa equivalencia para el HTML reservado, sin relajar tamaño, nombre, autor ni inmutabilidad. Verifica `portable-apps` privado en cada entorno; si falta, créalo con `npx -y @insforge/cli@latest storage create-bucket portable-apps --private`. Una fusión de rama backend puede copiar su configuración, pero no sus objetos. Nunca conviertas este bucket en público. No se importan apps ni datos históricos.

## Despliegue

El frontend se publica como una aplicación Next.js mediante el hosting gestionado de InsForge, con Vercel como proveedor. No es una exportación estática ni requiere reescrituras SPA hacia `index.html`.

Para publicar una revisión desde la raíz del código fuente:

```sh
npm run build
npx -y @insforge/cli@latest deployments deploy . --json
```

Se despliega el código fuente, no `.next`. Las exclusiones de `.vercelignore` mantienen fuera del despliegue credenciales, herramientas y archivos ajenos a la aplicación.

La URL de producción es compartida: cada publicación sustituye a la anterior, aunque proceda de otro worktree. Antes de desplegar, integra las revisiones ya publicadas y coordina las publicaciones concurrentes. Tras publicar, comprueba el comportamiento en la URL pública con una sesión autorizada; el estado `READY` de una publicación anterior no garantiza que siga siendo la que atiende esa URL.

El entorno de hosting requiere `NEXT_PUBLIC_INSFORGE_URL`, `NEXT_PUBLIC_INSFORGE_ANON_KEY`, `APP_URL`/`NEXT_PUBLIC_APP_URL` e `INSFORGE_API_KEY`. Solo la URL y la clave anónima del backend pueden exponerse mediante las variables públicas de InsForge; las credenciales privilegiadas deben permanecer exclusivamente en el servidor.

Azure OpenAI se utiliza desde el servidor Next.js en desarrollo y producción, con configuración persistente por organización. El puente `npm run dev:llm` es una herramienta local independiente y permanece deshabilitado en los despliegues públicos; la aplicación ya no depende de él ni de `BLK_ENABLE_LOCAL_LLM`.

## Azure OpenAI por organización

En **Admin → Configuración org · LLM Settings**, el Admin de la organización o un superadministrador puede guardar el endpoint, el **nombre del modelo desplegado (deployment)** y su API key. Por ejemplo:

```text
https://tu-recurso.services.ai.azure.com/openai/v1/responses
```

También se admiten recursos `openai.azure.com` y la URL base del recurso o `/openai/v1`; se normalizan a `/openai/v1/responses`. Esta API no requiere una fecha `api-version`. El deployment debe admitir **Responses v1 y salida JSON**. «Probar conexión» comprueba una respuesta JSON real y consume cuota; guardar la configuración no llama a Azure.

Las peticiones utilizan `text.format.type: json_object` y solicitan JSON explícitamente también en `input`, tanto en la prueba como en la generación e iteración. Incluir esa instrucción solo en `instructions` no basta para los recursos que validan el modo JSON sobre `input`. El endpoint identifica el recurso, pero no selecciona un modelo: «Modelo desplegado» debe coincidir exactamente con el nombre del deployment de ese recurso. Los rechazos de Azure distinguen el deployment, la operación Responses y el formato JSON cuando el proveedor identifica la causa; nunca muestran su mensaje sin filtrar ni reintentan con un formato menos estricto.

Las credenciales se guardan en `public.organization_azure` de InsForge, con cifrado **AES-256-GCM** ligado a la organización, endpoint y deployment. El navegador solo recibe los metadatos y el estado, nunca la API key guardada. Dejar la API key vacía al editar conserva la anterior; el campo se vacía tras cada operación. Reiniciar o desplegar Next.js no borra la configuración.

El hosting debe mantener `AZURE_SETTINGS_ENCRYPTION_KEY` exclusivamente en el servidor: 32 bytes aleatorios codificados en base64 o 64 caracteres hexadecimales. Conservar esta clave entre despliegues; cambiarla sin migrar las credenciales impide descifrarlas y obliga a volver a guardarlas. Nunca debe llevar un prefijo público ni incluirse en Git.

Las rutas usan la sesión SSR y `tk_identity`; los RPC y RLS aíslan las organizaciones. Solo Admin/superadmin pueden guardar, probar y borrar; los usuarios con acceso a Studio (`developer`, `admin`, `superadmin`) generan con la configuración de su empresa. Hay control de versión concurrente, una petición activa por organización y un límite compartido de 12 llamadas por minuto. La migración `migrations/20261101184520_organization-azure-responses.sql` mantiene estos controles y admite el endpoint v1 de Foundry.

«Borrar credenciales» elimina la configuración de esa empresa. Los errores de autenticación, configuración, cuota o respuesta de Azure se comunican sin generar versiones demo. Solo se generan dashboards declarativos con datos sintéticos; no se añaden conectores corporativos ni ejecución de código cloud.

`npm run test:next:llm` comprueba el flujo en Next.js **production**, con identidades, InsForge y Azure sintéticos y servidores exclusivos de loopback. No crea cuentas ni datos cloud ni consume cuota de Azure. El dominio publicado refleja la última revisión desplegada.

## Marca

La marca visible es **Tektonik hub**, con el monograma **TH**. El entorno de creación se presenta como **Tektonik hub Studio**.
