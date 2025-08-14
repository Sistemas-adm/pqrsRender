// public/dashboard/js/inactivar.js

/**
 * Inicializa los handlers para el modal de inactivación/reactivación de usuarios.
 * Debes llamar a window.initInactivar() después de inyectar reporte.html en el DOM.
 */
window.initInactivar = function () {
  console.log("Inicializando inactivar.js");

  const btnInactivar = document.getElementById("mostrarInactivarUsuarioBtn");
  const modal = document.getElementById("inactivarUsuarioModal");
  const cerrarBtn = document.getElementById("cerrarInactivarUsuarioModal");
  const buscarBtn = document.getElementById("buscarUsuarioBtn");
  const busquedaInput = document.getElementById("busquedaUsuario");
  const datosDiv = document.getElementById("datosUsuarioEncontrado");

  console.log("btnInactivar:", btnInactivar, "modal:", modal);

  // Si faltan elementos, abortar
  if (
    !btnInactivar ||
    !modal ||
    !cerrarBtn ||
    !buscarBtn ||
    !busquedaInput ||
    !datosDiv
  ) {
    console.warn("Inactivar.js: elementos no encontrados, revisa tu HTML");
    return;
  }

  let usuarioBuscado = null;

  // Abrir modal
  btnInactivar.addEventListener("click", () => {
    modal.style.display = "block";
    busquedaInput.value = "";
    datosDiv.innerHTML = "";
  });

  // Cerrar modal
  cerrarBtn.addEventListener("click", () => {
    modal.style.display = "none";
    busquedaInput.value = "";
    datosDiv.innerHTML = "";
  });

  // Buscar usuario
  buscarBtn.addEventListener("click", async () => {
    const q = busquedaInput.value.trim();
    datosDiv.innerHTML = "";
    usuarioBuscado = null;

    if (!q) {
      datosDiv.textContent = "Ingrese un dato para buscar";
      return;
    }

    datosDiv.textContent = "Buscando...";
    try {
      const res = await fetch(
        `/api/buscar-usuario?q=${encodeURIComponent(q)}`,
        {
          credentials: "include",
        }
      );
      const user = await res.json();

      if (!res.ok) {
        datosDiv.innerHTML = `<span style="color:red;">${
          user.message || "No encontrado"
        }</span>`;
        return;
      }

      usuarioBuscado = user;
      datosDiv.innerHTML = `
        <div style="margin:10px 0;">
          <b>Usuario:</b> ${user.usuario}<br>
          <b>Nombre:</b> ${user.nombre}<br>
          <b>Correo:</b> ${user.correo}<br>
          <b>Rol:</b> ${
            user.rol_id == 1
              ? "Admin"
              : user.rol_id == 2
              ? "Analista"
              : "Responsable"
          }<br>
          <b>Sede:</b> ${user.sede}<br>
          <b>Estado:</b> <span style="color:${
            user.activo ? "#21c45a" : "#c41e1e"
          };">
            ${user.activo ? "ACTIVO" : "INACTIVO"}
          </span>
        </div>
-       <button id="btnToggleInactivarUsuario">
-         ${user.activo ? "Inactivar" : "Activar"}
-       </button>
+       <button id="btnToggleInactivarUsuario">
+         ${user.activo ? "Inactivar" : "Activar"}
+       </button>
+       <button id="btnEditarUsuario" style="margin-left:8px;">
+         Editar
+       </button>
      `;
    } catch (err) {
      console.error("Error de red o servidor en buscar-usuario:", err);
      datosDiv.innerHTML = `<span style="color:red;">Error de red o servidor</span>`;
    }
  });

  // Delegación de click en el botón de activar/inactivar
  datosDiv.addEventListener("click", async (e) => {
    if (
      e.target &&
      e.target.id === "btnToggleInactivarUsuario" &&
      usuarioBuscado
    ) {
      const accion = usuarioBuscado.activo ? "inactivar" : "activar";
      if (!confirm(`¿Seguro que deseas ${accion} a este usuario?`)) return;

      try {
        const res2 = await fetch(
          `/api/inactivar-usuario/${usuarioBuscado.id}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ activo: usuarioBuscado.activo ? 0 : 1 }),
          }
        );
        const r2 = await res2.json();

        if (res2.ok) {
          datosDiv.innerHTML += `<div style="color:green; margin-top:8px;">${r2.message}</div>`;
          buscarBtn.click(); // recarga el estado actualizado
        } else {
          datosDiv.innerHTML += `<div style="color:red; margin-top:8px;">${
            r2.message || "Error"
          }</div>`;
        }
      } catch (err) {
        console.error("Error de red o servidor en inactivar-usuario:", err);
        datosDiv.innerHTML = `<span style="color:red;">Error de red o servidor</span>`;
      }
    }
  });
};
