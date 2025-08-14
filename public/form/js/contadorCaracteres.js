const textarea = document.getElementById('descripcion');
const contador = document.getElementById('contador-caracteres');
const maxCaracteres = 5000;

// Inicializar el contador al cargar
contador.textContent = `Caracteres: 0 / ${maxCaracteres}`;

textarea.addEventListener('input', function() {
  const longitud = textarea.value.length;
  contador.textContent = `Caracteres: ${longitud} / ${maxCaracteres}`;
});





