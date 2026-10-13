# Asistente Comercial · Gmail

Aplicación local para ayudar a cada comercial a revisar y gestionar sus propios correos de Gmail. El backend mantiene separadas las cuentas, cifra los tokens OAuth y usa OpenAI únicamente para analizar la cuenta activa.

## Estado actual

- OAuth con Gmail mediante `gmail.modify` y `gmail.send` para las acciones autorizadas.
- Cambio de cuenta con una sola sesión activa por navegador.
- Roles `admin` y `commercial`.
- El administrador gestiona usuarios, pero no obtiene el contenido de los correos de otros usuarios.
- Bandejas de recibidos y enviados.
- Búsqueda y lectura de hilos completos.
- Responder desde un hilo y redactar correos nuevos.
- Vista previa y confirmación obligatoria antes de enviar.
- Registro de acciones de Gmail sin guardar el contenido del correo.
- Asistente con hechos, inferencias, acciones, fuentes y aviso de revisión humana.
- Tokens Google cifrados localmente.
- Base preparada para organizaciones, usuarios y conexiones de IA compartidas o personales.
- La bandeja sincroniza Gmail al entrar, permite actualizar manualmente y se refresca automáticamente cada 10 minutos; las consultas de IA fuerzan una sincronización previa.
- Pruebas automáticas de sesiones, roles, cifrado y rutas protegidas.

## Ejecutar en local

1. Instalar dependencias:

   ```bash
   npm install
   ```

2. Crear `.env` a partir de `.env.example` y completar las credenciales localmente. No subir `.env` al repositorio.

3. Ejecutar las pruebas:

   ```bash
   npm test
   ```

4. Arrancar el servidor:

   ```bash
   npm run dev
   ```

   Abrir `http://localhost:3000/`.

La configuración detallada de Google está en [`docs/configuracion-cuenta-google-oauth.md`](docs/configuracion-cuenta-google-oauth.md).

La preparación del contenedor y el despliegue futuro en Cloud Run están descritos en [`docs/despliegue-cloud-run.md`](docs/despliegue-cloud-run.md). El contenedor no debe usarse todavía con usuarios reales porque el almacenamiento local de tokens debe migrarse antes a una solución persistente.

## Arquitectura

La descripción de responsabilidades, privacidad y evolución a producción está en [`docs/arquitectura-backend.md`](docs/arquitectura-backend.md).

La guía visual y navegable para explicar el proyecto de principio a fin está en [`docs/arquitectura-navegable.html`](docs/arquitectura-navegable.html). Se puede abrir directamente en el navegador y contiene un índice, buscador, diagramas, flujo de usuarios, despliegue, copias y preguntas frecuentes.

La evolución a varias empresas y las conexiones OpenAI/Claude están documentadas en [`docs/arquitectura-multiempresa.md`](docs/arquitectura-multiempresa.md).

El plan de despliegue provisional en Dinahosting y la prueba remota en un segundo hosting están documentados en [`docs/despliegue-dinahosting.md`](docs/despliegue-dinahosting.md).

Reglas de trabajo del agente: [`docs/reglas-seguridad-trabajo-con-ia.md`](docs/reglas-seguridad-trabajo-con-ia.md).

Especificación del agente: [`docs/agente-asistente-comercial-openai.md`](docs/agente-asistente-comercial-openai.md).

## Antes de producción

- Activar `DATA_STORE=firestore` y usar Secret Manager antes de conectar usuarios reales en remoto.
- Usar HTTPS y actualizar el redirect URI de Google.
- Revisar la verificación OAuth y la política de usuarios de prueba.
- Añadir auditoría de accesos sin guardar contenido de correo en los logs.
- Configurar límites de coste y uso de OpenAI.
- Mantener las rutas Gmail vinculadas exclusivamente a la sesión activa.
- Volver a autorizar las cuentas conectadas antes de activar los permisos de escritura.
