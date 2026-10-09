# Configuración de la cuenta Google y Gmail OAuth

## Propósito

Este documento registra, paso a paso, la prueba realizada para confirmar que la cuenta empresarial de Google Workspace puede conectarse a una aplicación propia mediante OAuth 2.0 y Gmail API.

La prueba demuestra la viabilidad técnica de conectar el buzón `dev@publicidadsegmentadatv.com` en modo lectura. No significa todavía que la aplicación de producción esté terminada ni que todos los usuarios de la organización estén autorizados.

## Contexto y decisión de alcance

- La cuenta pertenece a una organización de Google Workspace.
- Disponemos de una cuenta de usuario y sus credenciales, pero no se asumió acceso de administrador de Workspace.
- El objetivo es construir una aplicación para un comercial, con posibilidad de añadir más comerciales.
- No se creó un proyecto ni una configuración por cada correo.
- La estrategia es un único proyecto OAuth y un único cliente OAuth para varias cuentas, con autorización independiente por usuario.
- La cuenta de cada trabajador nunca se conecta usando su contraseña dentro de nuestra aplicación: cada usuario autoriza su propia cuenta mediante OAuth.
- Un correo de Microsoft/Outlook no se conectaría mediante Gmail API; requeriría Microsoft Graph. Esta prueba solo valida cuentas Gmail/Google Workspace.

## Repositorio y protección de secretos

El repositorio de trabajo es:

```text
https://github.com/agcidoncha/control-gmail.git
```

La carpeta local del proyecto contiene el prototipo y la documentación. Se creó un `.gitignore` con estas reglas:

```gitignore
OAuth client created/
.DS_Store
```

La carpeta `OAuth client created/` contiene el JSON descargado por Google Cloud y una captura de pantalla. Toda la carpeta queda fuera de Git. El JSON no debe subirse a GitHub, enviarse por chat ni incluirse en el frontend.

Si un secreto se copia accidentalmente a un repositorio, un log, una captura o una conversación, debe considerarse expuesto y revocarse o regenerarse.

## Cuentas y proyectos que no deben confundirse

Durante la configuración aparecieron varias cuentas en el navegador:

- **Cuenta empresarial válida para la prueba:** `dev@publicidadsegmentadatv.com`.
- **Cuenta personal que provocó una selección incorrecta:** `angel.cidoncha@gmail.com`.
- **Proyecto antiguo no relacionado:** `saascorreo`; no se utiliza para este desarrollo.

La cuenta correcta se comprobó en el selector de Google antes de aceptar los permisos. Siempre hay que verificar el correo mostrado en la pantalla de consentimiento.

## 1. Crear el proyecto de Google Cloud

1. Iniciar sesión en Google Cloud con `dev@publicidadsegmentadatv.com`.
2. Crear un proyecto nuevo.
3. Nombre visible utilizado: `control-gmail`.
4. ID de proyecto creado: `galvanized-yew-511113-d4`.
5. No utilizar el proyecto `saascorreo` ni el proyecto creado accidentalmente con la cuenta personal.
6. No pulsar **Start free** ni activar servicios de facturación para esta prueba de Gmail OAuth.

La consola mostró en distintos puntos el texto de organización de Cloud, por lo que no se debe inferir a partir de esa etiqueta si se tienen permisos de administrador de Workspace. Lo que importa para esta prueba es que el usuario `dev` pudo crear y configurar el proyecto y autorizar su buzón.

## 2. Activar Gmail API

1. Dentro del proyecto `control-gmail`, abrir **APIs y servicios**.
2. Buscar **Gmail API**.
3. Pulsar **Enable/Activar**.
4. Comprobar que el panel de Gmail API aparece sin errores.

Una página de métricas sin tráfico es normal antes de realizar la primera llamada. La activación de Gmail API no concede acceso por sí sola: el acceso al buzón se concede después mediante OAuth.

## 3. Configurar Google Auth Platform

### 3.1 Información de la aplicación

En **Google Auth Platform** se configuró:

- **Nombre de la aplicación:** `Asistente Comercial`.
- **Correo de asistencia del usuario:** `dev@publicidadsegmentadatv.com`.
- No se utilizó el nombre antiguo “Asistente Comercial Bético” para la pantalla OAuth.

### 3.2 Tipo de audiencia

Se eligió **External/Externa** porque la consola estaba trabajando el proyecto como sin organización para la configuración OAuth. Esto permite añadir cuentas concretas como usuarios de prueba.

Estado observado: **Testing/Pruebas**.

### 3.3 Usuarios de prueba

Se añadió como usuario de prueba:

```text
dev@publicidadsegmentadatv.com
```

Mientras la aplicación permanezca en estado de pruebas:

- cada cuenta que vaya a probarse debe añadirse en **Audience → Test users**;
- cada trabajador debe autorizar individualmente su propia cuenta;
- el cliente OAuth y el proyecto pueden ser los mismos para todos;
- el límite mostrado por la consola para usuarios de prueba era de hasta 100, pero debe comprobarse en la consola si Google cambia esa cuota;
- una cuenta no añadida como usuario de prueba puede quedar bloqueada aunque el proyecto y el cliente sean correctos.

Añadir a un usuario como test user no convierte a la aplicación en una aplicación de producción ni sustituye las políticas del administrador de Workspace.

### 3.4 Permiso utilizado

Se añadió y guardó el ámbito:

```text
https://www.googleapis.com/auth/gmail.readonly
```

Descripción de Google: ver los mensajes y la configuración del correo.

Este permiso permite leer, pero no enviar, borrar, modificar ni crear borradores. Para una aplicación que redacte o envíe habrá que estudiar ámbitos adicionales y los requisitos de verificación de Google. No se deben pedir permisos más amplios de lo necesario.

## 4. Crear el cliente OAuth

En **Google Auth Platform → Clients** se creó un cliente con estos valores:

- **Tipo de aplicación:** Web application.
- **Nombre interno:** `control-gmail-prueba`.
- **Orígenes JavaScript autorizados:** ninguno.
- **URI de redirección autorizada:**

```text
https://developers.google.com/oauthplayground
```

- **Use this client for an AI-powered agent:** no se activó.
- **Estado:** Enabled.

Google mostró un **Client ID** y un **Client Secret**. El Client Secret se descargó mediante **Download JSON** y se guardó dentro de `OAuth client created/`, carpeta excluida por `.gitignore`.

No se documentan aquí los valores del Client ID ni del Client Secret. El Client Secret es confidencial y nunca debe aparecer en el repositorio, el frontend, una captura, un log o una conversación.

Puede ser necesario esperar unos minutos a que un cambio de cliente se propague. Google indicó que algunos ajustes pueden tardar desde unos minutos hasta algunas horas.

## 5. Prueba temporal con OAuth 2.0 Playground

El Playground se usó únicamente como herramienta de validación de la configuración OAuth. No es la arquitectura de producción.

### 5.1 No reutilizar la autorización del cliente predeterminado

Inicialmente el Playground tenía una autorización realizada con el cliente predeterminado de Google. Esa autorización se revocó desde la página de aplicaciones vinculadas de la cuenta. No se debe confundir con el cliente propio del proyecto `control-gmail`.

### 5.2 Configurar el cliente propio

1. Abrir [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Pulsar el engranaje **Options**.
3. Activar **Use your own OAuth credentials**.
4. Copiar desde el JSON descargado el valor de `client_id` y pegarlo en **Client ID**.
5. Copiar desde el JSON descargado únicamente el valor de `client_secret` y pegarlo en **Client Secret**.
6. No incluir comillas, espacios ni saltos de línea.
7. Cerrar la ventana de configuración.

### 5.3 Solicitar autorización

1. En **Input your own scopes** introducir:

```text
https://www.googleapis.com/auth/gmail.readonly
```

2. Pulsar **Authorize APIs**.
3. En el selector de cuentas elegir:

```text
Desarrollo Web — dev@publicidadsegmentadatv.com
```

4. No elegir `angel.cidoncha@gmail.com`.
5. Aceptar el permiso de lectura cuando aparezca la pantalla de consentimiento.
6. De vuelta en el Playground, pulsar **Exchange authorization code for tokens**.

### 5.4 Error encontrado y solución

En el primer intento con el cliente propio aparecieron dos problemas:

- Se seleccionó por error la cuenta personal `angel.cidoncha@gmail.com`.
- El Client ID y, después, el Client Secret se copiaron con caracteres incorrectos.

Los errores observados fueron:

```text
HTTP 401 Unauthorized
invalid_client
The OAuth client was not found.
```

y posteriormente:

```text
HTTP 401 Unauthorized
invalid_client
The provided client secret is invalid.
```

La solución fue:

1. volver a la cuenta correcta `dev@publicidadsegmentadatv.com`;
2. copiar el Client ID directamente del JSON;
3. copiar el Client Secret directamente del JSON;
4. comprobar que el Client ID termina en `.apps.googleusercontent.com`;
5. no introducir espacios, comillas ni caracteres modificados;
6. repetir el intercambio.

El intercambio correcto respondió `HTTP 200 OK` y devolvió los tokens de acceso necesarios para la prueba. Los valores de esos tokens no se guardan en este documento.

## 6. Prueba real contra el buzón

En el **Step 3: Configure request to API** del Playground se utilizó:

- **Método:** `GET`.
- **Request URI:**

```text
https://gmail.googleapis.com/gmail/v1/users/me/profile
```

La respuesta final fue:

```text
HTTP/1.1 200 OK
```

Y confirmó:

- `emailAddress`: `dev@publicidadsegmentadatv.com`;
- `threadsTotal`: 8 en el momento de la prueba;
- `messagesTotal`: 8 en el momento de la prueba.

Este resultado prueba que el proyecto, Gmail API, cliente OAuth, cuenta empresarial, usuario de prueba, permiso `gmail.readonly` y flujo de autorización funcionan juntos.

## 7. Qué queda demostrado y qué no

### Queda demostrado

- La cuenta empresarial concreta puede autorizar una aplicación OAuth propia.
- La aplicación puede consultar Gmail mediante Gmail API.
- El permiso de lectura funciona desde el cliente OAuth creado en el proyecto.
- La cuenta correcta es `dev@publicidadsegmentadatv.com`.
- Se puede usar el mismo proyecto y cliente para incorporar más cuentas mediante autorizaciones separadas.

### Todavía no queda demostrado

- Que todas las cuentas de los trabajadores estén añadidas como usuarios de prueba.
- Que el administrador de Workspace permita el uso de la aplicación para todos los usuarios.
- Que una cuenta de Outlook/Microsoft funcione con Gmail API.
- Que enviar, modificar o crear borradores sea posible con los permisos actuales.
- Que la aplicación cumpla los requisitos de verificación OAuth de Google para uso público.
- Que el servidor de producción tenga HTTPS, Node persistente, cron, MySQL, backups y gestión segura de secretos.
- Que OpenAI API esté configurada o que el agente comercial esté desplegado.

## 8. Siguiente proceso recomendado

1. Mantener `gmail.readonly` y construir primero la sincronización de lectura.
2. Implementar OAuth en el backend Node.js/TypeScript, no en el frontend.
3. Guardar tokens cifrados y asociados al usuario correcto.
4. Añadir una cuenta adicional como usuario de prueba cuando exista autorización para probarla.
5. Comprobar que cada usuario solo ve su propia cuenta.
6. Crear el listado de hilos y la detección determinista de respuestas y antigüedad.
7. Añadir IA solo para resumen, extracción de compromisos, clasificación y redacción.
8. Mantener los borradores sujetos a aprobación humana.
9. Estudiar permisos de escritura, verificación OAuth y políticas de administración antes de pedir acceso adicional.
10. Revocar el acceso del Playground cuando deje de ser necesario y repetir la prueba desde la aplicación propia.

## 9. Referencia de seguridad

Esta configuración debe respetar `docs/reglas-seguridad-trabajo-con-ia.md`:

- no inferir datos críticos;
- no sobredimensionar la solución;
- no integrar código externo sin verificarlo;
- no abrir líneas de trabajo sin objetivo;
- cuestionar decisiones que no cuadren;
- declarar inmediatamente si el plan deja de ser suficiente.

