# Despliegue en Dinahosting

## Decisión actual

El destino provisional de la aplicación es:

`asistente-comercial.publicidadsegmentadatv.com`

Este subdominio pertenece al entorno principal de Dinahosting y será el destino de producción mientras se valida la aplicación. No se debe cambiar el dominio principal ni sus registros de correo durante las pruebas.

Además, se realizará una prueba remota independiente en otro hosting de Dinahosting. Esa segunda instalación sirve para validar el proceso de despliegue, no sustituye todavía al entorno principal.

## Entorno principal

- Proveedor: Dinahosting.
- Subdominio: `asistente-comercial.publicidadsegmentadatv.com`.
- Aplicación: frontend Astro SSR y backend Node.js/Fastify.
- Persistencia: MySQL.
- Procesos: PM2.
- HTTPS: Let’s Encrypt.
- DNS: debe estar publicado en el proveedor que gestione actualmente los DNS autoritativos de `publicidadsegmentadatv.com`.

Importante: crear un registro en el panel de un hosting no garantiza que sea público. Antes de solicitar Let’s Encrypt hay que comprobar que el registro A resuelve públicamente:

```text
asistente-comercial -> 82.98.132.124
```

Si Dinahosting indica que sus DNS no están activos para el dominio, el registro debe añadirse en el proveedor DNS autoritativo o se deben cambiar los nameservers con cuidado. Antes de cambiar nameservers hay que conservar los registros MX, SPF, DKIM y demás registros actuales del correo.

## Prueba remota en el segundo hosting

La prueba remota se hará inicialmente en:

- Dominio/subdominio de prueba: `lab.thelocalhost.es`.
- Host SSH: `ftp.thelocalhost.es`.
- Usuario SSH: `thelocalhost`.

La clave privada SSH no se guarda en el repositorio. La prueba debe hacerse con un dominio o subdominio cuyos DNS sí estén gestionados por ese segundo entorno. Debe validar, en este orden:

1. Acceso SSH y versión compatible de Node.js.
2. Instalación limpia con `npm ci` en backend y frontend.
3. Variables de entorno creadas fuera de Git.
4. Base de datos MySQL y migraciones.
5. Compilación de backend y frontend.
6. Ejecución persistente con PM2.
7. Resolución DNS pública.
8. Certificado Let’s Encrypt.
9. Proxy HTTPS entre el dominio, Astro y la API.
10. Flujo completo de Google OAuth, Gmail y conexiones de IA.

La prueba remota no debe reutilizar tokens OAuth, claves API ni el `.env` del entorno principal. Las credenciales deben ser independientes y revocables.

## Registro del despliegue realizado

Se mantienen dos despliegues separados para no confundir la validación técnica con el entorno principal:

| Entorno | URL | Uso | Estado registrado |
|---|---|---|---|
| Principal/provisional | `https://asistente-comercial.publicidadsegmentadatv.com/` | Entorno previsto para la aplicación principal | Preparado en el hosting principal; su disponibilidad pública depende de que el DNS autoritativo apunte al servidor correcto. |
| Prueba remota | `https://lab.thelocalhost.es/` | Validación independiente del despliegue en Dinahosting | DNS y certificado Let’s Encrypt comprobados. La aplicación Node se ha solicitado en el panel y queda pendiente de que Dinahosting complete el alta y el enrutamiento público. |

### Entorno principal: `asistente-comercial.publicidadsegmentadatv.com`

- Hosting: Dinahosting.
- Servidor usado durante la primera prueba: `hl1464.dinaserver.com`.
- Usuario SSH: `publicidadsegmentadatv`.
- Proyecto remoto: `/home/publicidadsegmentadatv/asistente-comercial`.
- IP que se tuvo que comprobar para el subdominio: `82.98.132.124`.
- Componentes: Node.js, frontend Astro SSR, backend Fastify, MySQL y PM2.
- Problema conocido: el subdominio no estaba bajo el DNS autoritativo de ese hosting, por lo que Let’s Encrypt no podía validar el dominio. No se debe modificar el DNS de correo sin conservar antes MX, SPF, DKIM y demás registros.

### Prueba remota: `lab.thelocalhost.es`

- Hosting: segundo hosting de Dinahosting asociado a `thelocalhost.es`.
- Servidor SSH: `ftp.thelocalhost.es` (`hl1591.dinaserver.com`).
- Usuario SSH: `thelocalhost`.
- Proyecto remoto: `/home/thelocalhost/asistente-comercial`.
- Carpeta web existente: `/home/thelocalhost/lab`.
- IP pública comprobada para el subdominio: `82.98.164.44`.
- Node.js comprobado: `v22.23.3`.
- npm comprobado: `10.9.9`.
- Cliente MySQL disponible.
- Certificado comprobado con Let’s Encrypt para `thelocalhost.es`, válido del 17 de septiembre al 16 de diciembre de 2026.

#### Pasos ejecutados en la prueba remota

1. Se creó el repositorio remoto mediante clonación y se actualizó con `git pull --ff-only origin main`.
2. Se instalaron las dependencias del backend:

   ```bash
   npm ci
   ```

3. Se instalaron las dependencias del frontend:

   ```bash
   cd frontend
   npm ci
   npm run build
   cd ..
   npm run build
   ```

4. El frontend Astro se compiló correctamente como servidor con `@astrojs/node`.
5. Se creó `.env` en el servidor, fuera de Git. Incluye la conexión MySQL, Google OAuth, sesiones, cifrado de tokens, cifrado de conexiones de IA, OpenAI y Claude. No se guardan aquí valores reales.
6. Se corrigió `DATA_STORE=mysql` para que la aplicación utilizase MySQL en lugar del almacenamiento local.
7. La migración inicial se ejecutó correctamente:

   ```text
   Migración MySQL aplicada: db/migrations/001_initial_mysql_schema.sql
   ```

8. Se instalaron las dependencias de ejecución de PM2 y se levantaron dos procesos:

   - `assistant-commercial-api`: backend en el puerto interno `3003`.
   - `assistant-commercial-frontend`: Astro en `127.0.0.1:4321`.

9. PM2 guardó la configuración con `pm2 save` y ambos procesos quedaron en estado `online`.
10. Desde el propio servidor, backend y frontend respondieron correctamente en sus puertos internos.
11. En el panel de Dinahosting se solicitó una aplicación Node.js 22.23 con:

   - raíz: `/lab/asistente-comercial`;
   - ejecutable: `lab/asistente-comercial/dist/server/entry.mjs`;
   - mostrar errores activado.

12. El panel mostró primero la solicitud como `Alta de nueva aplicación /lab/asistente-comercial`, en proceso de aplicación. Posteriormente la aplicación pasó a aparecer en `Aplicaciones actuales`.

13. Mientras Dinahosting completa el alta, se añadió temporalmente en `/home/thelocalhost/lab/.htaccess` una redirección de `/` a `/asistente-comercial/`. Esto permite comprobar la portada, pero no sustituye el enrutamiento de la aplicación Node y no se considera la configuración definitiva.

#### Última comprobación remota

Comprobación realizada el 12 de octubre de 2026 desde el propio servidor:

- `http://127.0.0.1:3003/health` respondió `200`.
- `http://127.0.0.1:4321/` respondió `200`.
- `http://127.0.0.1:4321/dashboard` respondió `200`.
- El DNS de `lab.thelocalhost.es` resolvió a `82.98.164.44`.
- `https://lab.thelocalhost.es/` respondió `302` hacia `/asistente-comercial/`.
- `https://lab.thelocalhost.es/asistente-comercial/` respondió `200` y mostró la interfaz Astro.
- `https://lab.thelocalhost.es/dashboard`, `/me` y `/gmail/messages` respondieron `404` del servidor web.
- La aplicación `/lab/asistente-comercial/` también aparece activa en el panel, pero sus rutas públicas probadas devuelven `404`; por tanto, el alta figura en el panel, pero falta verificar/configurar su URI pública.
- Se apartó temporalmente el `.htaccess` para descartar que sus reglas antiguas fueran la causa; el dominio raíz continuó devolviendo `404`. El archivo se restauró inmediatamente y se conservó una copia de prueba.
- La URL antigua `https://lab.thelocalhost.es/asistente-comercial/` llega a mostrar HTML, pero sin estilos: el HTML solicita `/_astro`, `/scripts` y `/brand` desde la raíz y esos recursos devuelven `404`. Esto confirma que esa URL es un montaje incompleto/antiguo y no debe considerarse la publicación definitiva.

Interpretación: el código compilado y los procesos internos funcionan; el dominio público todavía no está enlazado a la URI de la aplicación Node correcta. Hasta que Dinahosting corrija ese enlace, no se debe probar OAuth, Gmail ni las acciones de correo en la URL remota.

#### Pendiente antes de considerar `lab.thelocalhost.es` operativo

- Esperar a que Dinahosting finalice el alta de la aplicación Node.
- Confirmar que `https://lab.thelocalhost.es/` devuelve la interfaz Astro directamente, sin depender de la redirección temporal a `/asistente-comercial/`.
- Confirmar que `/dashboard`, `/mailbox`, `/follow-ups`, `/commitments`, `/me` y `/gmail/messages` ya no devuelven `404`.
- Configurar el enrutamiento de las rutas `/auth`, `/gmail`, `/ai`, `/admin`, `/me`, `/assistant` y `/brand` hacia el backend Fastify.
- Repetir la prueba de Google OAuth con el redirect URI del entorno de pruebas.
- Probar Gmail y las acciones de correo con la cuenta de prueba, sin reutilizar tokens del entorno principal.

El `404` actual no demuestra un fallo del código: indica que el servidor web público todavía no ha asociado el subdominio con la aplicación Node. No se debe marcar el despliegue como terminado hasta superar las comprobaciones anteriores.

## Criterio para pasar a producción

El entorno principal solo se considera listo cuando:

- El subdominio resuelve públicamente.
- HTTPS funciona con un certificado válido.
- Astro y la API responden bajo el mismo dominio.
- MySQL conserva usuarios, sesiones y conexiones cifradas.
- Google OAuth usa el redirect URI de producción.
- Se valida el aislamiento entre administrador y comerciales.
- Se prueban lectura, archivado, marcado como leído, papelera y vuelta atrás.
- PM2 reinicia correctamente los procesos.
- No se han publicado secretos ni archivos `.env`.

