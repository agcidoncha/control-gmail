# Despliegue en Hostinger VPS

## Objetivo

La aplicación se prueba en el VPS de Hostinger mediante:

- URL: `https://lab.thelocalhost.es`
- VPS: `srv1877441.hstgr.cloud`
- Sistema: Ubuntu 24.04 con Docker y Easypanel
- Arquitectura: backend Fastify, frontend Astro SSR y MySQL en contenedores

El despliegue anterior de Dinahosting se conserva como entorno de respaldo y referencia. No se copian secretos al repositorio.

## Arquitectura

```text
Internet
   |
   | HTTPS / Let's Encrypt
   v
Traefik de Easypanel (80/443)
   |
   v
Frontend Astro (4321) -- red Docker easypanel
   |
   v
Backend Fastify (3000) -- red interna de Docker
   |
   v
MySQL 8.4 -- volumen persistente mysql_data
```

El frontend usa `BACKEND_URL=http://api:3000`, por lo que no depende de puertos internos expuestos al exterior. El puerto 3000 del host pertenece a Easypanel y no se modifica.

## Estado actual

- Las imágenes Docker de backend y frontend se construyen correctamente en el VPS.
- MySQL está levantado y saludable.
- La migración `db/migrations/001_initial_mysql_schema.sql` se ha aplicado.
- El endpoint interno `/health` responde correctamente.
- El frontend responde correctamente por el VPS.
- `lab.thelocalhost.es` se ha cambiado en DNS a `191.215.35.202`.
- Traefik tiene una ruta HTTP→HTTPS para `lab.thelocalhost.es` y solicita el certificado con el resolver `letsencrypt`.
- La prueba directa contra el VPS devuelve `200` y el título `Asistente Comercial · Gmail`.

## Archivos de despliegue

- `Dockerfile`: imagen del backend.
- `frontend/Dockerfile`: build y runtime de Astro SSR.
- `docker-compose.hostinger.yml`: MySQL, backend, frontend y etiquetas Traefik.
- `scripts/configure-hostinger-env.sh`: prepara variables privadas del servidor y arranca el compose. No contiene valores secretos.
- `.env`: solo existe en el servidor y nunca debe subirse a Git.

## Variables privadas

El `.env` del VPS contiene las credenciales de Google, OpenAI/Claude, sesión, cifrado y MySQL. Debe tener permisos `600`. Las variables importantes para este entorno son:

```text
DATA_STORE=mysql
MYSQL_HOST=mysql
MYSQL_PORT=3306
FRONTEND_URL=https://lab.thelocalhost.es
GOOGLE_REDIRECT_URI=https://lab.thelocalhost.es/auth/google/callback
```

Las claves de cifrado se generan si están vacías. No se deben regenerar después de guardar tokens o conexiones, porque dejarían de poder descifrarse.

## Operación habitual

Desde `/opt/asistente-comercial` en el VPS:

```bash
docker compose -f docker-compose.hostinger.yml ps
docker compose -f docker-compose.hostinger.yml logs --tail=100 api
docker compose -f docker-compose.hostinger.yml logs --tail=100 frontend
docker compose -f docker-compose.hostinger.yml up -d --build
```

## Protección antes de desplegar

Cada `push` a `main` ejecuta la verificación de GitHub Actions. Además, la imagen de la API vuelve a ejecutar `npm test` durante la construcción; si falla un test, la imagen no se construye y EasyPanel no puede ponerla en servicio.

Después de un despliegue, Docker comprueba automáticamente `/health` de la API y del frontend. La API también verifica que MySQL responde; un contenedor que no pase el health check no se considera listo.

Antes de una migración o cambio importante, crear una copia de la base de datos:

```bash
bash scripts/backup-mysql.sh
```

El script guarda copias comprimidas en `backups/` y conserva por defecto los últimos 14 días. Esa carpeta debe copiarse también fuera del VPS si se necesita protección frente a una pérdida completa del servidor.

### Copia automática diaria

Para instalar una tarea diaria en el VPS, ejecutar una sola vez como `root` desde `/opt/asistente-comercial`:

```bash
sudo APP_DIR=/opt/asistente-comercial bash scripts/install-backup-cron.sh
```

Por defecto se ejecuta todos los días a las 03:15 UTC. La tarea usa `flock` para evitar dos copias simultáneas, escribe el registro en `/var/log/asistente-comercial-mysql-backup.log` y conserva los últimos 14 días. Para cambiar el horario, por ejemplo a las 04:30 UTC:

```bash
sudo BACKUP_CRON_SCHEDULE='30 4 * * *' APP_DIR=/opt/asistente-comercial bash scripts/install-backup-cron.sh
```

Para comprobar que está instalada:

```bash
sudo cat /etc/cron.d/asistente-comercial-mysql-backup
sudo tail -n 50 /var/log/asistente-comercial-mysql-backup.log
ls -lh backups/
```

La copia local del VPS protege frente a errores de aplicación, pero no frente a la pérdida completa del servidor. Antes de producción hay que copiar periódicamente `backups/` a otro almacenamiento y probar una restauración.

Para una nueva versión:

1. Subir el código sin `.env`, `.data`, `node_modules` ni `dist`.
2. Ejecutar `docker compose -f docker-compose.hostinger.yml up -d --build`.
3. Aplicar migraciones si existen nuevas:

```bash
docker compose -f docker-compose.hostinger.yml exec -T api node dist/migrate-mysql.js
```

4. Comprobar la URL pública y el callback de Google.

Si un despliegue sale mal, no se debe borrar el volumen MySQL. La recuperación recomendada es volver al commit anterior y desplegarlo:

```bash
git revert <commit-problematico>
git push origin main
```

Después se comprueba `docker compose -f docker-compose.hostinger.yml ps` y la URL pública. Para cambios de base de datos, restaurar primero una copia verificada en una base de pruebas; no restaurar directamente sobre producción sin detener el servicio y confirmar el punto de recuperación.

## DNS y certificado

El registro que debe apuntar al VPS es:

```text
Tipo: A
Host: lab
Valor: 191.215.35.202
```

La emisión de Let’s Encrypt depende de que el DNS público ya resuelva al VPS. Si un equipo sigue viendo la aplicación antigua, suele ser caché DNS local; se puede comprobar con resolvers públicos o esperar la propagación.

## Pendientes antes de producción

- Confirmar el inicio de sesión Google usando el callback de `lab.thelocalhost.es`.
- Revisar que el OAuth consent screen y los usuarios de prueba estén configurados.
- Ejecutar una primera copia automática y configurar una copia externa periódica de `backups/`.
- Añadir monitorización externa de `/health` y una política de actualización de imágenes.
- Decidir cuándo sustituir definitivamente la URL de prueba por la URL principal.
