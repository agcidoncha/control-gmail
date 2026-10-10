(() => {
  const form = document.querySelector('#userAuthorizationForm');
  const emailNode = document.querySelector('#authorizedUserEmail');
  const roleNode = document.querySelector('#authorizedUserRole');
  const messageNode = document.querySelector('#userAuthorizationMessage');
  const usersNode = document.querySelector('#authorizedUsers');
  const screen = document.querySelector('#adminUsersScreen');
  if (!form || !emailNode || !roleNode || !messageNode || !usersNode || !screen) return;

  const showMessage = (value, type = '') => {
    messageNode.textContent = value;
    messageNode.className = 'form-message' + (type ? ' ' + type : '');
  };

  const renderUsers = (users) => {
    usersNode.replaceChildren();
    users.forEach((user) => {
      const row = document.createElement('div');
      row.className = 'authorized-user';
      const email = document.createElement('strong');
      email.textContent = user.email;
      const details = document.createElement('small');
      details.textContent = (user.role === 'admin' ? 'Administrador' : 'Comercial') + ' · ' + (user.accessStatus === 'active' ? 'Autorizado' : user.accessStatus);
      row.append(email, details);
      usersNode.append(row);
    });
    if (!users.length) usersNode.textContent = 'No hay usuarios autorizados.';
  };

  const loadUsers = async () => {
    const response = await fetch('/admin/users');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los usuarios.');
    renderUsers(data.users.filter((user) => user.accessStatus === 'active'));
  };

  const checkAdminAccess = async () => {
    const response = await fetch('/me');
    const account = await response.json();
    if (!response.ok || account.role !== 'admin') {
      window.location.replace('/dashboard');
      return false;
    }
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
