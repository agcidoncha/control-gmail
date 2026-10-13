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

El asistente recibe solo el contexto de la cuenta activa. No ejecuta acciones por su cuenta: su salida distingue hechos, inferencias y acciones propuestas, y marca cuándo hace falta revisión humana. Las operaciones de correo se inician únicamente desde la interfaz de Gmail y requieren una decisión explícita del usuario.

## Permisos y operaciones de Gmail

- El OAuth solicita `gmail.modify` para marcar mensajes, archivar y enviar a la papelera, y `gmail.send` para redactar y responder.
- Las cuentas conectadas antes de activar estos permisos deben volver a autorizarse desde «Cambiar de cuenta»; hasta entonces las acciones devuelven una indicación de reautorización.
- `PATCH /gmail/messages/:messageId` acepta `markRead`, `markUnread`, `archive`, `unarchive` y `trash`. `unarchive` se usa para deshacer un archivado reciente. La cuenta se obtiene de la sesión y nunca de un parámetro del navegador.
- `POST /gmail/send` valida destinatario, asunto y cuerpo en backend. Puede crear un correo nuevo o responder dentro del hilo usando `threadId` y los encabezados de respuesta del mensaje padre.
- En la interfaz, enviar a papelera y enviar un correo piden una decisión explícita. El asistente no puede disparar estas rutas.
- La interfaz permite revisar el destinatario, asunto y cuerpo antes de confirmar el envío. La auditoría registra la acción y su resultado sin guardar el contenido del mensaje.
- La siguiente ampliación prevista es añadir borradores, etiquetas, destacados y restauración desde papelera.

## Análisis comercial y uso bajo demanda

- `/gmail/insights` genera las fichas iniciales de clientes con remitentes, destinatarios, número de mensajes y última actividad.
- `/gmail/client-history` carga el historial de un cliente solo cuando el usuario pulsa `Ver historial`; no se consulta todo el historial de todos los clientes al abrir la pantalla.
- La bandeja comercial es independiente del análisis: puede cargar mensajes por páginas y no queda limitada al periodo de IA.
- El análisis automático usa por defecto los últimos 30 días (`AI_ANALYSIS_DAYS=30`). Esto limita el contexto que se envía al modelo y ayuda a controlar el consumo.
- Dentro del periodo elegido el backend recorre las páginas de Gmail, no solo los 10 mensajes visibles. `AI_MAX_MESSAGES=100` establece el límite de protección por bandeja; se puede subir conscientemente si la organización acepta el coste y el tiempo adicional.
- `POST /assistant/ask` acepta `analysisDays` o un rango `analysisFrom`/`analysisTo` en formato `AAAA-MM-DD`. La interfaz ofrece un mes, tres meses, seis meses, un año o un rango personalizado; al ampliar el periodo avisa de que puede aumentar el consumo y pide confirmación.
- `POST /assistant/ask` también acepta `analysisScope`: `mailbox` (bandeja y enviados, opción predeterminada), `all` (todos los mensajes, incluidos los archivados) o `spam`. Los dos últimos alcances consultan Gmail directamente y avisan en la interfaz de que pueden aumentar las consultas y el coste.
- Los seguimientos, compromisos y fichas de clientes también parten de la ventana por defecto de 30 días. El historial de un cliente se mantiene bajo demanda y puede consultar mensajes anteriores.
- Cada mensaje de hilo conserva indicios de fechas y plazos para apoyar la revisión de compromisos.
- Los compromisos se clasifican como posibles incumplimientos, pendientes de revisión o pendientes de respuesta según las fechas detectadas y la existencia de mensajes posteriores. Son heurísticas y siempre requieren revisión humana.
- La categoría `Briefing pendiente` se detecta en seguimientos y se puede filtrar desde la pantalla de Seguimientos.
- El botón `Analizar necesidades` prepara una consulta en `/consultar-ia`, pero no llama al proveedor ni consume API hasta que el usuario pulsa `Analizar correos`.
- Los contadores del menú reutilizan durante 30 segundos los resultados de esa sesión del navegador para evitar duplicar consultas Gmail al cambiar de pantalla.
- Si Gmail devuelve una limitación de cuota, el backend la transforma en un aviso entendible y no expone el mensaje técnico completo en la interfaz.

## Persistencia y sincronización de Gmail

La interfaz no debe consultar Gmail cada vez que se abre una pantalla. El backend mantiene una copia de trabajo por cuenta, separada por correo:

- `gmail_accounts/{email}`: estado de la última sincronización y ventana cubierta.
- `gmail_accounts/{email}/messages/{messageId}`: metadatos de los mensajes.
- `gmail_accounts/{email}/threads/{threadId}`: mensajes normalizados de cada hilo.

En local se utiliza `.data/gmail-store.json`; cuando `DATA_STORE=firestore`, se utilizan las colecciones equivalentes de Firestore. Los cuerpos de los mensajes se cifran con `TOKEN_ENCRYPTION_KEY` antes de persistirse. Los mensajes y hilos nunca se devuelven a una sesión distinta de la cuenta autenticada.

La primera sincronización cubre por defecto la ventana de análisis configurada (`AI_ANALYSIS_DAYS`, 30 días), recorre páginas de Gmail y limita la carga a `GMAIL_SYNC_MAX_MESSAGES` por bandeja. La interfaz sincroniza al entrar en la bandeja, ofrece el botón «Actualizar Gmail» y vuelve a sincronizar automáticamente cada 10 minutos. El intervalo de seguridad del backend se configura con `GMAIL_SYNC_INTERVAL_SECONDS` (600 segundos por defecto). Cada análisis de IA fuerza además una sincronización previa para no razonar sobre una copia antigua.

La siguiente evolución de producción será sustituir la resincronización periódica por `historyId` y `users.watch`, para traer únicamente cambios nuevos. Hasta entonces, la ventana y el intervalo son límites explícitos de coste y cuota, no valores ocultos en la interfaz.

## Estado local y evolución

En local se usan `.data/users.json` y `.data/google-tokens.enc`, ambos ignorados por Git. El backend ya admite `DATA_STORE=firestore` para guardar usuarios y tokens en Firestore; los tokens siguen cifrados individualmente con `TOKEN_ENCRYPTION_KEY`. Para producción deben configurarse:

- Firestore con usuarios, roles y metadatos.
- Firestore con tokens cifrados por cuenta.
- Secret Manager para `TOKEN_ENCRYPTION_KEY` y el resto de secretos.
- Sesiones persistentes y revocables.
- Auditoría de accesos sin registrar cuerpos de correo.
- Límites de uso por usuario y control de costes de OpenAI.

### MySQL en el hosting

El hosting previsto ofrece Node.js y MySQL, por lo que MySQL será el almacén de producción recomendado. El esquema inicial está en `db/migrations/001_initial_mysql_schema.sql` e incluye organizaciones, usuarios, tokens cifrados, conexiones de IA, caché de Gmail e historial de acciones. En local se conserva `DATA_STORE=local` para poder desarrollar sin depender del servidor; al desplegar se usará `DATA_STORE=mysql` y las variables `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` y `MYSQL_SSL`.

La tabla `gmail_actions` no guarda cuerpos de mensajes ni claves: solo registra quién ejecutó una acción, sobre qué cuenta y mensaje, cuándo terminó y si tuvo éxito. El adaptador Node/MySQL y la migración de datos desde `.data/` son pasos posteriores antes del despliegue; este esquema no implica que se hayan subido datos al hosting.

## Reglas para nuevas funcionalidades

Antes de añadir una ruta o una función:

1. Identificar el usuario desde la sesión, nunca desde el navegador.
2. Validar rol y autorización en backend.
3. Evitar devolver tokens o cuerpos de correo si no son necesarios.
4. Añadir una prueba de aislamiento o permisos.
5. Mantener el frontend como cliente del backend, no como autoridad.
