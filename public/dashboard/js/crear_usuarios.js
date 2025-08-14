// public/dashboard/js/crear_usuarios.js

function initCrearUsuarios() {
  const section = document.getElementById("crearUsuarioSection");
  if (!section) return;

  // Sólo rol 1 y 2
  const rol_id = localStorage.getItem("rol_id");
  if (rol_id !== "1" && rol_id !== "2") {
    section.style.display = "none";
    return;
  }
  section.style.display = "";

  // Elementos clave
  const btnMostrar  = document.getElementById("mostrarCrearUsuarioBtn");
  const modal       = document.getElementById("crearUsuarioModal");
  const btnCerrar   = document.getElementById("cerrarCrearUsuarioModal");
  const btnCancelar = document.getElementById("cancelarCrearUsuarioBtn");
  const form        = document.getElementById("crearUsuarioForm");
  const msgDiv      = document.getElementById("crearUsuarioMsg");
  const inputNombre = form.querySelector('input[name="nombre"]');

  // Forzar mayúsculas
  inputNombre.addEventListener("input", () => {
    inputNombre.value = inputNombre.value.toUpperCase();
  });

  // Funciones para abrir / cerrar
  function abrirModal() {
    form.reset();
    msgDiv.textContent = "";
    modal.classList.add("open");
  }
  function cerrarModal() {
    modal.classList.remove("open");
  }

  // Listeners
  btnMostrar.addEventListener("click", abrirModal);
  btnCerrar.addEventListener("click", cerrarModal);
  btnCancelar.addEventListener("click", cerrarModal);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    msgDiv.textContent = "";

    if (!data.sede) {
      msgDiv.style.color = "red";
      msgDiv.textContent = "❌ Debe seleccionar la sede.";
      return;
    }

    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();

      if (res.ok && json.success) {
        msgDiv.style.color = "green";
        msgDiv.textContent = "✅ Usuario creado.";
        // cierra modal después de un instante
        setTimeout(cerrarModal, 1200);
      } else {
        msgDiv.style.color = "red";
        msgDiv.textContent = "❌ " + (json.message || "Falló la creación");
      }
    } catch {
      msgDiv.style.color = "red";
      msgDiv.textContent = "❌ Error en la solicitud.";
    }
  });
}

window.initCrearUsuarios = initCrearUsuarios;
