document.getElementById('loginForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const usuario = document.getElementById('usuario').value.trim();
  const clave   = document.getElementById('clave').value;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, clave })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      localStorage.setItem('rol', data.rol);
      localStorage.setItem('rol_id', data.rol_id);
      localStorage.setItem('userId', data.user_id); // ← ¡ESTO DEBE SER SIEMPRE EL ID DEL USUARIO!
      window.location.href = '/dashboard/index.html';
    } else {
      alert(data.message || 'Usuario o contraseña incorrectos');
    }
  } catch (err) {
    console.error(err);
    alert('Error de red o servidor.');
  }
});
