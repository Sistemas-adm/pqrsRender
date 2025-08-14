// public/dashboard/js/editarUsuario.js

window.initEditarUsuario = function() {
  console.log("Inicializando editarUsuario.js");

  // Elementos principales
  const btnOpen        = document.getElementById("mostrarEditarUsuarioBtn");
  const modal          = document.getElementById("editarUsuarioModal");
  const btnClose       = document.getElementById("cerrarEditarUsuarioModal");
  const busquedaInput  = document.getElementById("editarBusquedaInput");
  const btnBuscar      = document.getElementById("editarBuscarBtn");
  const msgBusqueda    = document.getElementById("editarBusquedaMsg");
  const form           = document.getElementById("editarUsuarioForm");
  const resultMsg      = document.getElementById("editarResultMsg");
  const toggleSection  = document.getElementById("editarToggleSection");
  const btnToggle      = document.getElementById("btnToggleActivo");
  const statusSpan     = document.getElementById("statusActivo");

  let usuarioBuscado = null;

  // Verificación de elementos
  if (!btnOpen || !modal || !btnClose || !busquedaInput || !btnBuscar ||
      !msgBusqueda || !form || !resultMsg || !toggleSection ||
      !btnToggle || !statusSpan) {
    console.warn("editarUsuario.js: faltan elementos en el DOM");
    return;
  }

  // 1) Abrir sidebar
  btnOpen.addEventListener("click", () => {
    modal.classList.add("open");
    msgBusqueda.textContent      = "";
    busquedaInput.value          = "";
    form.style.display           = "none";
    toggleSection.style.display  = "none";
    resultMsg.textContent        = "";
  });

  // 2) Cerrar sidebar
  btnClose.addEventListener("click", () => {
    modal.classList.remove("open");
  });

  // 3) Buscar usuario
  btnBuscar.addEventListener("click", async () => {
    const q = busquedaInput.value.trim();
    if (!q) {
      msgBusqueda.textContent = "Ingresa usuario, correo o nombre";
      return;
    }
    msgBusqueda.textContent     = "Buscando...";
    form.style.display          = "none";
    toggleSection.style.display = "none";
    resultMsg.textContent       = "";

    try {
      const res  = await fetch(
        `/api/buscar-usuario?q=${encodeURIComponent(q)}`, 
        { credentials: "include" }
      );
      const data = await res.json();

      if (!res.ok) {
        msgBusqueda.textContent = data.message || "No encontrado";
        return;
      }

      usuarioBuscado = data;
      msgBusqueda.textContent = "";

      // Rellenar formulario
      document.getElementById("editNombre").value = data.nombre;
      document.getElementById("editCorreo").value = data.correo;
      document.getElementById("editRol").value    = data.rol_id;
      document.getElementById("editSede").value   = data.sede;
      form.style.display          = "block";

      // Mostrar toggle activo/inactivo
      toggleSection.style.display = "block";
      btnToggle.textContent       = data.activo ? "Inactivar" : "Activar";
      statusSpan.textContent      = data.activo ? "ACTIVO" : "INACTIVO";
    } catch (err) {
      console.error(err);
      msgBusqueda.textContent = "Error de red o servidor";
    }
  });

  // 4) Enviar cambios de datos personales
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!usuarioBuscado) return;

    resultMsg.textContent = "";
    try {
      const payload = {
        nombre: document.getElementById("editNombre").value.trim(),
        correo: document.getElementById("editCorreo").value.trim(),
        rol_id: document.getElementById("editRol").value,
        sede:   document.getElementById("editSede").value,
      };
      const res = await fetch(
        `/api/usuarios/${usuarioBuscado.id}`, {
          method:      "PATCH",
          credentials: "include",
          headers:     { "Content-Type": "application/json" },
          body:        JSON.stringify(payload),
        }
      );
      const data = await res.json();

      if (!res.ok) throw data;

      resultMsg.style.color   = "green";
      resultMsg.textContent   = data.message;
      Object.assign(usuarioBuscado, payload);
      setTimeout(() => { resultMsg.textContent = ""; }, 2000);
    } catch (err) {
      resultMsg.style.color   = "red";
      resultMsg.textContent   = err.message || "Error actualizando usuario";
    }
  });

  // 5) Toggle Activo / Inactivo
  btnToggle.addEventListener("click", async () => {
    if (!usuarioBuscado) return;

    const nuevoEstado = usuarioBuscado.activo ? 0 : 1;
    try {
      const res = await fetch(
        `/api/inactivar-usuario/${usuarioBuscado.id}`, {
          method:      "PATCH",
          credentials: "include",
          headers:     { "Content-Type": "application/json" },
          body:        JSON.stringify({ activo: nuevoEstado }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw data;

      resultMsg.style.color    = "green";
      resultMsg.textContent    = data.message;
      usuarioBuscado.activo    = nuevoEstado;
      btnToggle.textContent    = nuevoEstado ? "Inactivar" : "Activar";
      statusSpan.textContent   = nuevoEstado ? "ACTIVO" : "INACTIVO";
      setTimeout(() => { resultMsg.textContent = ""; }, 2000);
    } catch (err) {
      resultMsg.style.color  = "red";
      resultMsg.textContent  = err.message || "Error cambiando estado";
    }
  });
};
