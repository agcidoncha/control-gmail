# Arquitectura backend

## Principio principal

El backend es la fuente de verdad. El HTML solo presenta datos y solicita operaciones; nunca decide qué cuenta puede consultar ni recibe tokens de Google.

## Flujo de una sesión

1. El usuario inicia OAuth con Google.
2. Google devuelve un `code` y un `state` de un solo uso.
3. El backend valida el `state`, obtiene los tokens y consulta el perfil Gmail.
4. Los tokens se guardan cifrados asociados al email de Google.
5. Se crea una cookie de sesión firmada, HttpOnly y con caducidad.
6. Cada ruta privada obtiene el email exclusivamente desde esa cookie.
7. Las llamadas Gmail cargan los tokens asociados a ese email.

## Módulos

| Módulo | Responsabilidad |
| --- | --- |
| `src/server.ts` | Rutas HTTP, respuestas y HTML del panel actual. |
| `src/session.ts` | Firma, lectura, expiración y limpieza de sesiones. |
| `src/google-oauth.ts` | OAuth, perfil Gmail, mensajes, enviados e hilos. |
| `src/token-store.ts` | Cifrado AES-256-GCM y almacenamiento de tokens por cuenta. |
| `src/user-store.ts` | Usuarios, roles y fechas de acceso. |
| `src/assistant.ts` | Contexto autorizado, reglas del agente y llamada a OpenAI. |

## Aislamiento entre cuentas

- No existe un parámetro de cuenta aceptado por las rutas Gmail.
- Aunque el navegador solicite otra cuenta, el backend usa la cuenta de la sesión.
- `dev@publicidadsegmentadatv.com` no puede acceder a `/admin/users`.
- La administración devuelve usuarios y roles, nunca correos ni tokens.
- Cambiar de cuenta elimina la cookie anterior antes de iniciar OAuth.
- En producción, cada comercial debe tener su propia sesión y no compartir cookies.

## Privacidad del asistente

El asistente recibe solo el contexto de la cuenta activa y trabaja en modo lectura. No puede enviar, borrar, archivar, etiquetar ni modificar mensajes. Su salida distingue hechos, inferencias y acciones propuestas, y marca cuándo hace falta revisión humana.

## Estado local y evolución

En local se usan `.data/users.json` y `.data/google-tokens.enc`, ambos ignorados por Git. Para producción deben sustituirse por:

- Base de datos con usuarios, roles y metadatos.
- Almacén de secretos o KMS para tokens OAuth.
- Sesiones persistentes y revocables.
- Auditoría de accesos sin registrar cuerpos de correo.
- Límites de uso por usuario y control de costes de OpenAI.

## Reglas para nuevas funcionalidades

Antes de añadir una ruta o una función:

1. Identificar el usuario desde la sesión, nunca desde el navegador.
2. Validar rol y autorización en backend.
3. Evitar devolver tokens o cuerpos de correo si no son necesarios.
4. Añadir una prueba de aislamiento o permisos.
5. Mantener el frontend como cliente del backend, no como autoridad.
