# Arquitectura multiempresa y conexiones de IA

## Objetivo

La aplicación empieza con una empresa, pero no debe quedar diseñada como si solo pudiera existir una. La base es una aplicación multiempresa preparada para evolucionar a SaaS sin mezclar los datos de compañías, usuarios, cuentas Gmail ni conexiones de IA.

La empresa inicial es **Publicidad Segmentada TV**.

```text
Plataforma
└── Organización: Publicidad Segmentada TV
    ├── Usuario: angel.cidoncha@gmail.com · admin
    └── Usuario: dev@publicidadsegmentadatv.com · commercial
```

## Principios de aislamiento

1. Cada usuario tiene una sesión independiente.
2. Cada cuenta Gmail se consulta únicamente a partir del usuario autenticado.
3. Cada usuario pertenece a una organización mediante `organizationId`.
4. Las consultas futuras deben filtrar siempre por organización y usuario; nunca se debe aceptar una cuenta o empresa enviada libremente desde el navegador.
5. El administrador puede gestionar usuarios y configuración, pero no recibe por defecto el contenido de los correos de otros usuarios.
6. Las claves de IA no se muestran en el frontend ni se escriben en logs.
7. Los correos se envían al proveedor de IA solo para la cuenta Gmail activa y autorizada.

## Modelo de datos

### `organizations`

Representa una empresa dentro de la plataforma.

```text
id
name
status: active | suspended
createdAt
```

La organización inicial utiliza el identificador `org_publicidad_segmentada_tv`. Se puede cambiar mediante `DEFAULT_ORGANIZATION_ID` sin modificar el código.

### `users`

Representa a la persona que inicia sesión con Google.

```text
email
organizationId
role: admin | commercial
createdAt
lastLoginAt
```

El campo `organizationId` se añade automáticamente a los usuarios antiguos para mantener compatibilidad con el almacenamiento local existente.

### `google_tokens`

Guarda los tokens OAuth cifrados por cuenta Gmail. La clave del documento es el correo autorizado. En la futura migración SaaS debe añadirse también `organizationId` y una política de pertenencia explícita.

### `ai_connections` — siguiente fase

Modelará las conexiones de inteligencia artificial:

```text
id
organizationId
userEmail (opcional para conexiones personales)
provider: openai | claude
mode: company_shared | user_personal
credentialEncrypted
model
status
createdAt
updatedAt
```

La credencial nunca se devuelve al navegador. Solo el backend podrá resolverla durante una petición autorizada.

## Conexiones de IA

Cada usuario podrá elegir entre:

- **IA de empresa**: una conexión OpenAI o Claude configurada para toda la organización.
- **Mi conexión personal**: una credencial privada que solo se utiliza para ese usuario.

La conexión de empresa será la opción inicial. En este momento el proyecto la resuelve mediante `OPENAI_API_KEY`, `OPENAI_MODEL` y `OPENAI_REASONING_EFFORT`. La resolución ya está separada en `src/ai-connections.ts` para que la futura pantalla de configuración no tenga que cambiar la lógica del asistente.

Claude está modelado como proveedor permitido, pero todavía no tiene adaptador de ejecución. No se debe seleccionar como proveedor activo hasta implementar su cliente, validación y almacenamiento seguro.

La interfaz común prevista es:

```text
AiProvider
├── OpenAIProvider
└── ClaudeProvider
```

El asistente recibirá siempre el contexto de la organización y del usuario. Así podremos registrar el uso por empresa, proveedor, usuario y cuenta Gmail sin compartir datos entre organizaciones.

## Facturación y límites

La conexión compartida debe imputar consumo a la empresa. La conexión personal debe imputarlo a la cuenta del propio usuario. En una versión SaaS se añadirán:

- plan de la organización;
- límite mensual de peticiones o tokens;
- uso agregado por proveedor;
- alertas de consumo;
- eventos de uso sin guardar el contenido completo del correo.

No se implementan todavía pagos, suscripciones ni dominios personalizados porque solo existe una empresa real en esta fase.

## Estado implementado

- La organización inicial se crea automáticamente si no existe.
- Los usuarios incorporan `organizationId` al iniciar sesión.
- La cookie de sesión incluye la organización activa.
- `/me` devuelve la organización activa además del usuario y el rol.
- La resolución inicial de IA queda centralizada y etiquetada como `company_shared`.
- El almacenamiento local continúa funcionando para desarrollo.
- Firestore mantiene una colección separada de organizaciones cuando `DATA_STORE=firestore`.

## Próximos pasos

1. Crear la pantalla de configuración de IA.
2. Añadir almacenamiento cifrado para claves personales.
3. Implementar el adaptador Claude.
4. Añadir endpoints protegidos para conectar, probar, cambiar y desconectar proveedores.
5. Añadir `organizationId` a tokens Gmail, conexiones IA, auditoría y eventos de uso.
6. Añadir un selector de organización solo cuando un usuario pueda pertenecer a más de una.
7. Antes del despliegue, migrar secretos a Secret Manager y revisar las reglas de acceso de Firestore.

## Seguridad de API

Las claves de API deben cargarse en el servidor o en un gestor de secretos, nunca en el navegador ni en el repositorio. Para OpenAI, la documentación oficial contempla claves asociadas a proyectos y cuentas de servicio, incluso con caducidad opcional: [cuentas de servicio de proyectos de OpenAI](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/projects/subresources/service_accounts).

La suscripción de ChatGPT y la facturación de la API son productos separados. Para consumir la API hay que configurar la facturación de la plataforma API: [facturación de ChatGPT y API](https://help.openai.com/es-es/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform).

## Decisiones que no se deben perder

- Una empresa puede usar OpenAI, Claude o ambos.
- Un usuario puede usar la conexión de empresa o una personal.
- La IA elegida no cambia los permisos Gmail.
- Cambiar de usuario debe cerrar la sesión anterior y no mostrar dos cuentas a la vez.
- El superadministrador no debe convertirse automáticamente en lector del correo de los comerciales.
- Una segunda empresa se añadirá creando otra organización, no duplicando el código de la aplicación.
