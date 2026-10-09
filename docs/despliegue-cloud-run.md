# Preparación para Cloud Run

## Estado

El proyecto ya tiene un `Dockerfile`, escucha en el puerto proporcionado por `PORT` y puede enlazar con `0.0.0.0`, que es necesario para Cloud Run.

Todavía no está listo para usuarios reales: los usuarios y tokens se guardan en `.data/`, que no debe tratarse como almacenamiento persistente dentro de un contenedor. Antes de producción hay que migrar ese almacenamiento a una base de datos y un gestor de secretos.

## Construcción local

```bash
docker build -t control-gmail:local .
docker run --rm -p 8080:8080 --env-file .env control-gmail:local
```

Para una prueba real, las variables deben introducirse desde el entorno seguro del proveedor. No se debe copiar `.env` dentro de la imagen.

## Preparación en Google Cloud

1. Seleccionar el proyecto de Google Cloud del desarrollo.
2. Activar Cloud Run, Cloud Build y Artifact Registry.
3. Crear un repositorio privado de imágenes.
4. Construir y publicar la imagen desde Cloud Build.
5. Desplegar el servicio con `PORT=8080`, `NODE_ENV=production` y `HOST=0.0.0.0`.
6. Configurar `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, credenciales Google y `OPENAI_API_KEY` mediante Secret Manager.
7. Añadir la URL HTTPS de Cloud Run como redirect URI en Google Auth Platform.
8. Mantener la aplicación en pruebas hasta completar la verificación OAuth.

## Bloqueos antes de producción

- Migrar `.data/users.json` y `.data/google-tokens.enc` a almacenamiento persistente.
- Definir copias de seguridad y revocación de tokens.
- Configurar dominio propio y HTTPS.
- Añadir límites de uso y coste para OpenAI.
- Revisar logs para que nunca contengan cuerpos de correo, tokens o credenciales.
- Probar el aislamiento con varios usuarios en el entorno remoto.
