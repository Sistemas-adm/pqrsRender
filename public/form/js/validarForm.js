/****************************************************************
 * validarForm.js
 * 1. Valida campos obligatorios (sin nacimiento)
 * 2. Envía el formulario a /api/submit con fetch + FormData
 * 3. Muestra banner con código SAC#; el usuario lo cierra con ✕
 * 4. Previene doble submit y fuerza campos a mayúsculas
 ****************************************************************/
document.addEventListener("DOMContentLoaded", () => {
  const formulario = document.getElementById("formulario");
  if (!formulario) {
    console.error('No se encontró <form id="formulario">');
    return;
  }

  const banner   = document.getElementById("mensaje-exito");
  const codigoEl = document.getElementById("codigo-solicitud");
  const closeBtn = banner?.querySelector(".close-btn");
  closeBtn?.addEventListener("click", () => banner.classList.remove("show"));

  // IDs de los campos requeridos (he eliminado "nacimiento")
  const camposObligatorios = [
    "persona","tipo","documeto_paciente","nombre",
    "sexo","origen","departamento","municipio",
    "direccion","celular","correo","descripcion"
  ];

  formulario.addEventListener("submit", async (e) => {
    e.preventDefault();
    let hayErrores = false;

    const submitBtn = formulario.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando...";

    // 1) Limpiar marcas previas
    document.querySelectorAll("label").forEach(l => l.classList.remove("error-label"));
    document.querySelectorAll("input, select, textarea")
            .forEach(el => el.classList.remove("error-campo"));

    // 2) Validar campos obligatorios
    camposObligatorios.forEach(id => {
      const campo = document.getElementById(id);
      const label = document.querySelector(`label[for="${id}"]`);
      if (campo && !campo.value.trim()) {
        hayErrores = true;
        campo.classList.add("error-campo");
        label?.classList.add("error-label");
      }
    });

    if (hayErrores) {
      document.querySelector(".error-campo")?.focus();
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar";
      return;
    }

    // 3) Forzar campos a mayúsculas
    ["nombre","direccion"].forEach(id => {
      const inp = document.getElementById(id);
      if (inp) inp.value = inp.value.toUpperCase();
    });

    // 4) Crear FormData y enviar
    try {
      const formData = new FormData(formulario);
      const resp  = await fetch("/api/submit", { method:"POST", body: formData });
      const json  = await resp.json();

      if (json.success) {
        codigoEl.textContent = `SAC${json.insertId}`;
        banner.classList.add("show");
        formulario.reset();
      } else {
        alert("Error del servidor: " + (json.message || "desconocido"));
      }
    } catch (err) {
      console.error(err);
      alert("No se pudo conectar al servidor");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar";
    }
  });

  // Quitar error al corregir campo
  camposObligatorios.forEach(id => {
    const campo = document.getElementById(id);
    const label = document.querySelector(`label[for="${id}"]`);
    if (!campo) return;
    const limpiar = () => {
      if (campo.value.trim()) {
        campo.classList.remove("error-campo");
        label?.classList.remove("error-label");
      }
    };
    campo.addEventListener("input", limpiar);
    campo.addEventListener("change", limpiar);
  });

  // Remover error en adjunto
  const campoAdj = document.getElementById("adjunto");
  const labelAdj = document.querySelector('label[for="adjunto"]');
  campoAdj?.addEventListener("change", () => {
    campoAdj.classList.remove("error-campo");
    labelAdj?.classList.remove("error-label");
  });
});
