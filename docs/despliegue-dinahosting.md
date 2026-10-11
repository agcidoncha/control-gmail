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

