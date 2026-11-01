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
| Perfil y envíos | `/profile` |
| Organización y gestión | `/company` |
| Creación conversacional | `/studio` |
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

```text
React / hooks → BLKProvider → RemoteBLKRepository → API Next.js
                                                    ↓
                               Cookies SSR + tk_identity / tk_workspace
                                                    ↓
                                      PostgreSQL / InsForge + RLS
```

Las rutas protegidas verifican identidad y rol en el servidor. Las operaciones de negocio se autorizan mediante PostgreSQL, con aislamiento por organización, restricciones de relaciones y control de versiones concurrentes. Archivar conserva el historial de revisiones y eventos.

Studio guarda el HTML enviado en `app_versions`. Para corregir una entrega, `/api/studio/source` recupera exclusivamente la versión autorizada, comprobando autor, empresa y estado. La sincronización cloud de conversaciones, la carga de binarios y un sandbox de ejecución de servidor siguen pendientes. Los documentos generados se previsualizan en un iframe aislado; esto no constituye una certificación de seguridad.

En `/studio`, la descripción escrita en el chatbot inicia la creación, sin elegir un proyecto de InsForge, un proveedor o una plantilla obligatoria. No se muestra ni se genera un registro de actividad del proyecto; se mantienen la conversación, las versiones y los borradores existentes. Las nuevas generaciones requieren el LLM configurado para la organización: no hay generación demo ni sustitución automática por plantillas locales. El servicio actual solo admite dashboards declarativos con datos sintéticos.

La interfaz se centra en conversación y vista previa, sin encabezado grande ni panel inferior de archivos. Una barra compacta arriba a la derecha reúne el estado del borrador, el indicador LLM, el reinicio y «Añadir ficheros». El indicador solo aparece verde tras confirmar la configuración de la organización; el texto al pasar el ratón o enfocar explica el estado, y pulsarlo reintenta la comprobación. También se actualiza al volver a la ventana. Los ficheros aparecen como referencias eliminables junto al chat: únicamente se guardan sus metadatos, no se carga ni se lee su contenido. Las opciones de preview, copia y exportación HTML se agrupan en «Más opciones»; no hay exportación habitual de borradores JSON. La recuperación del original se conserva únicamente ante fallos de almacenamiento.

El proyecto cloud **`tektonik-hub`** está en **EU Central (`eu-central`)**. Su backend es `https://vxpd968k.eu-central.insforge.app`; se administra desde el [panel de InsForge](https://insforge.dev/dashboard/project/621de563-b6b4-4041-b541-579e6128a916).

El esquema base es `migrations/20261101075915_identity-workspace.sql`, con 15 tablas de negocio, RPC autorizados y RLS. `migrations/20261101180821_studio-admin-access.sql` amplía los permisos de envío y corrección a los administradores sin modificar el resto de los controles del RPC. El diseño histórico de `database` no debe aplicarse sobre estas migraciones.

## Despliegue

El frontend se publica como una aplicación Next.js mediante el hosting gestionado de InsForge, con Vercel como proveedor. No es una exportación estática ni requiere reescrituras SPA hacia `index.html`.

Para publicar una revisión desde la raíz del código fuente:

```sh
npm run build
npx -y @insforge/cli@latest deployments deploy . --json
```

Se despliega el código fuente, no `.next`. Las exclusiones de `.vercelignore` mantienen fuera del despliegue credenciales, herramientas y archivos ajenos a la aplicación.

El entorno de hosting requiere `NEXT_PUBLIC_INSFORGE_URL`, `NEXT_PUBLIC_INSFORGE_ANON_KEY`, `APP_URL`/`NEXT_PUBLIC_APP_URL` e `INSFORGE_API_KEY`. Solo la URL y la clave anónima del backend pueden exponerse mediante las variables públicas de InsForge; las credenciales privilegiadas deben permanecer exclusivamente en el servidor.

El servicio LLM actual es un bridge exclusivo de desarrollo local y permanece deshabilitado en producción. Por tanto, la generación en el dominio público no está disponible hasta integrar un servicio LLM autorizado para producción; Studio comunica el fallo sin crear una versión ficticia. No hay conectores corporativos ni ejecución cloud. El dominio publicado refleja la última revisión desplegada.

## Marca

La marca visible es **Tektonik hub**, con el monograma **TH**. El entorno de creación se presenta como **Tektonik hub Studio**.
