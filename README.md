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

El proyecto cloud **`tektonik-hub`** está en **EU Central (`eu-central`)**. Su backend es `https://vxpd968k.eu-central.insforge.app`; se administra desde el [panel de InsForge](https://insforge.dev/dashboard/project/621de563-b6b4-4041-b541-579e6128a916).

La fuente del esquema vigente es `migrations/20261101075915_identity-workspace.sql`, con 15 tablas de negocio, RPC autorizados y RLS. El diseño histórico de `database` no debe aplicarse sobre esta migración.

## Despliegue

El frontend se publica como una aplicación Next.js mediante el hosting gestionado de InsForge, con Vercel como proveedor. No es una exportación estática ni requiere reescrituras SPA hacia `index.html`.

Para publicar una revisión desde la raíz del código fuente:

```sh
npm run build
npx -y @insforge/cli@latest deployments deploy . --json
```

Se despliega el código fuente, no `.next`. Las exclusiones de `.vercelignore` mantienen fuera del despliegue credenciales, herramientas y archivos ajenos a la aplicación.

El entorno de hosting requiere `NEXT_PUBLIC_INSFORGE_URL`, `NEXT_PUBLIC_INSFORGE_ANON_KEY`, `APP_URL`/`NEXT_PUBLIC_APP_URL` e `INSFORGE_API_KEY`. Solo la URL y la clave anónima del backend pueden exponerse mediante las variables públicas de InsForge; las credenciales privilegiadas deben permanecer exclusivamente en el servidor.

Studio permite generar ejemplos, sin conectores corporativos ni ejecución cloud. El dominio publicado refleja la última revisión desplegada.

## Marca

La marca visible es **Tektonik hub**, con el monograma **TH**. El entorno de creación se presenta como **Tektonik hub Studio**.
