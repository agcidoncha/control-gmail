(() => {
  const form = document.querySelector('#userAuthorizationForm');
  const emailNode = document.querySelector('#authorizedUserEmail');
  const roleNode = document.querySelector('#authorizedUserRole');
  const messageNode = document.querySelector('#userAuthorizationMessage');
  const usersNode = document.querySelector('#authorizedUsers');
  const screen = document.querySelector('#adminUsersScreen');
  if (!form || !emailNode || !roleNode || !messageNode || !usersNode || !screen) return;
  let currentAccountEmail = '';

  const showMessage = (value, type = '') => {
    messageNode.textContent = value;
    messageNode.className = 'form-message' + (type ? ' ' + type : '');
  };

  const renderUsers = (users) => {
    usersNode.replaceChildren();
    users.forEach((user) => {
      const row = document.createElement('div');
      row.className = 'authorized-user';
      const info = document.createElement('div');
      const email = document.createElement('strong');
      email.textContent = user.email;
      const details = document.createElement('small');
      details.textContent = (user.role === 'admin' ? 'Administrador' : 'Comercial') + ' · ' + (user.accessStatus === 'active' ? 'Conectado' : 'Desconectado');
      info.append(email, details);
      row.append(info);
      if (user.email.toLowerCase() !== currentAccountEmail) {
        const actions = document.createElement('div');
        actions.className = 'user-actions';
        if (user.accessStatus === 'active') {
          const disconnectButton = document.createElement('button');
          disconnectButton.type = 'button';
          disconnectButton.className = 'secondary-button';
          disconnectButton.textContent = 'Desconectar';
          disconnectButton.addEventListener('click', () => updateUser(user.email, 'disconnect'));
          actions.append(disconnectButton);
        } else {
          const reconnectButton = document.createElement('button');
          reconnectButton.type = 'button';
          reconnectButton.className = 'secondary-button';
          reconnectButton.textContent = 'Reconectar';
          reconnectButton.addEventListener('click', () => updateUser(user.email, 'reconnect', user.role));
          actions.append(reconnectButton);
        }
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'danger-button';
        deleteButton.textContent = 'Eliminar';
        deleteButton.addEventListener('click', () => updateUser(user.email, 'delete'));
        actions.append(deleteButton);
        row.append(actions);
      }
      usersNode.append(row);
    });
    if (!users.length) usersNode.textContent = 'No hay usuarios autorizados.';
  };

  const updateUser = async (email, action, role = 'commercial') => {
    const message = action === 'delete'
      ? `¿Eliminar definitivamente a ${email}? También se borrará su autorización y su conexión guardada.`
      : action === 'reconnect'
        ? `¿Volver a autorizar a ${email}?`
        : `¿Desconectar a ${email}? Podrás volver a autorizarlo después.`;
    if (!window.confirm(message)) return;
    showMessage(action === 'delete' ? 'Eliminando usuario…' : action === 'reconnect' ? 'Reconectando usuario…' : 'Desconectando usuario…');
    try {
      const response = await fetch(action === 'reconnect'
        ? '/admin/users'
        : '/admin/users/' + encodeURIComponent(email) + (action === 'delete' ? '' : '/disconnect'), {
        method: action === 'delete' ? 'DELETE' : 'POST',
        headers: action === 'reconnect' ? { 'content-type': 'application/json' } : undefined,
        body: action === 'reconnect' ? JSON.stringify({ email, role }) : undefined,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo actualizar el usuario.');
      showMessage(action === 'delete' ? 'Usuario eliminado.' : action === 'reconnect' ? 'Usuario reconectado.' : 'Usuario desconectado.', 'success');
      await loadUsers();
    } catch (error) {
      showMessage(error.message || 'No se pudo actualizar el usuario.', 'error');
    }
  };

  const loadUsers = async () => {
    const response = await fetch('/admin/users');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los usuarios.');
    renderUsers(data.users);
  };

  const checkAdminAccess = async () => {
    const response = await fetch('/me');
    const account = await response.json();
    if (!response.ok || account.role !== 'admin') {
      window.location.replace('/dashboard');
      return false;
    }
    currentAccountEmail = account.email.toLowerCase();
    screen.hidden = false;
    return true;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    if (button) button.disabled = true;
    showMessage('Autorizando usuario…');
    try {
      const response = await fetch('/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: emailNode.value, role: roleNode.value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo autorizar el usuario.');
      emailNode.value = '';
      showMessage('Usuario autorizado. Ya puede iniciar sesión con Google.', 'success');
      await loadUsers();
    } catch (error) {
      showMessage(error.message || 'No se pudo autorizar el usuario.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  });

  checkAdminAccess()
    .then((allowed) => allowed && loadUsers())
    .catch(() => window.location.replace('/dashboard'));
})();
