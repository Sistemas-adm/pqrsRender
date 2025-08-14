window.cargarEstadisticas = async function() {
  try {
    const res = await fetch('/api/estadisticas-pqrs', { credentials: 'include' });
    if (!res.ok) throw new Error('No se pudieron cargar las estadísticas');
    const data = await res.json();
    document.getElementById('pendientesCount').textContent = data.pendientes;
    document.getElementById('gestionCount').textContent = data.gestion;
    document.getElementById('resueltasCount').textContent = data.resueltas;
    document.getElementById('vecidoCount').textContent = data.vencido;
    document.getElementById("totalCount").textContent = data.total;



  } catch (e) {
    console.error('Error cargando estadísticas:', e);
  }
};
