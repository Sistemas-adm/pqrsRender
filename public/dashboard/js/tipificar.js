// --- FUNCIONES FECHA ---
function formatoFechaDDMMYYYY(fechaString) {
  if (!fechaString) return "";
  const d = new Date(fechaString);
  if (isNaN(d)) return fechaString;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const anio = d.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

function formatoFechaYYYYMMDD(fechaString) {
  if (!fechaString) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaString)) return fechaString;
  try {
    const d = new Date(fechaString);
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

// NUEVA: formato fecha/hora DD/MM/YYYY HH:MM
function formatoFechaDDMMYYYY_HHMM(fechaString) {
  if (!fechaString) return "";
  const d = new Date(fechaString);
  if (isNaN(d)) return fechaString;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const anio = d.getFullYear();
  const hora = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes}/${anio} ${hora}:${min}`;
}

function diasEntre(f1, f2) {
  if (!f1 || !f2) return "";
  const d1 = new Date(f1.split(" ")[0]);
  const d2 = new Date(f2.split(" ")[0]);
  if (isNaN(d1) || isNaN(d2)) return "";
  const ms = d1 - d2;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// === Nombre del analista logueado y etiqueta "Enviado por" (con persistencia) ===

// --------- NUEVA: función para calcular y actualizar VENCIDO automáticamente ----------
function actualizarVencidoAuto() {
  const fechaLimite = document.getElementById("fecha_limite_de_rta").value;
  const fechaResp = document.getElementById(
    "fecha_respuesta_responsable"
  ).value;
  const vencidoSelect = document.getElementById("vencido");

  if (!fechaLimite) {
    vencidoSelect.value = "";
    return;
  }

  // Si ya hay respuesta, SIEMPRE NO
  if (fechaResp && fechaResp.trim() !== "") {
    vencidoSelect.value = "NO";
    return;
  }

  const hoy = new Date();
  const fLimite = new Date(fechaLimite);
  fLimite.setHours(0, 0, 0, 0);
  hoy.setHours(0, 0, 0, 0);

  if (hoy > fLimite) {
    vencidoSelect.value = "SI";
  } else {
    vencidoSelect.value = "NO";
  }
}

// Carga lista de usuarios por rol (analista/responsable)
async function cargarUsuariosPorRol(rolId, selectId) {
  try {
    const res = await fetch(`/api/usuarios-por-rol/${rolId}`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("No se pudo cargar la lista");
    const usuarios = await res.json();
    const select = document.getElementById(selectId);
    select.innerHTML = `<option value="">--Selecciona--</option>`;
    usuarios.forEach((u) => {
      select.innerHTML += `<option value="${u.id}">${u.nombre} (${u.usuario})</option>`;
    });
  } catch (e) {
    alert(`Error al cargar usuarios para ${selectId}`);
  }
}

function actualizarIndicadorANS() {
  const fechaLimite = document.getElementById("fecha_limite_de_rta").value;
  const fechaResp = document.getElementById(
    "fecha_respuesta_responsable"
  ).value;
  const indicadorANS = document.getElementById("indicador_ans");
  if (fechaLimite && fechaResp) {
    const dLimite = new Date(fechaLimite);
    const dResp = new Date(fechaResp);
    if (!isNaN(dLimite) && !isNaN(dResp)) {
      if (dResp <= dLimite) {
        indicadorANS.value = "CUMPLE";
      } else {
        indicadorANS.value = "INCUMPLE";
      }
    } else {
      indicadorANS.value = "";
    }
  } else {
    indicadorANS.value = "";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // --- 1) ACORDEÓN ---
  const bloques = document.querySelectorAll(".bloque-acordeon");
  let abiertos = [];
  bloques.forEach((bloque) => {
    const titulo = bloque.querySelector(".bloque-titulo");
    titulo.addEventListener("click", () => {
      const abierto = bloque.classList.toggle("open");
      if (abierto) {
        abiertos.push(bloque);
        if (abiertos.length > 2) abiertos.shift().classList.remove("open");
      } else {
        abiertos = abiertos.filter((b) => b !== bloque);
      }
    });
    titulo.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        titulo.click();
      }
    });
  });

  // --- 2) SEQ Y CARGA INICIAL ---
  const params = new URLSearchParams(window.location.search);
  const seq = params.get("seq") || "";
  document.getElementById("sacNumber").textContent = seq ? `SAC-${seq}` : "";
  document.getElementById("seq").value = seq;

  // --- 3) POPULAR SELECTS ---
  await cargarUsuariosPorRol(2, "analista");
  await cargarUsuariosPorRol(3, "responsable");

  // --- 5) ENVÍO DE MENSAJE AL PACIENTE ---
  const btnEnviar = document.getElementById("enviarPacienteBtn");
  let etiquetaEnvio = document.getElementById("enviadoPorAnalista");
  if (!etiquetaEnvio && btnEnviar) {
    etiquetaEnvio = document.createElement("div");
    etiquetaEnvio.id = "enviadoPorAnalista";
    etiquetaEnvio.style.marginTop = "6px";
    etiquetaEnvio.style.fontSize = "12px";
    etiquetaEnvio.style.color = "#2e7d32";
    btnEnviar.insertAdjacentElement("afterend", etiquetaEnvio);
  }

  const rol_id_local = Number(localStorage.getItem("rol_id"));
  if (btnEnviar && rol_id_local === 3) {
    btnEnviar.disabled = true;
    btnEnviar.title =
      "Solo el analista o admin puede enviar mensaje al paciente";
    const feedback = document.getElementById("tareaFeedback");
    if (feedback) {
      feedback.style.color = "gray";
      feedback.textContent =
        "Solo el analista puede enviar el mensaje al paciente.";
    }
  } else if (btnEnviar) {
    btnEnviar.addEventListener("click", async () => {
      const mensaje = document.getElementById("mensajePaciente").value.trim();
      const archivoInput = document.getElementById("archivoAdjunto");
      const archivo = archivoInput ? archivoInput.files[0] : null;
      const feedback = document.getElementById("tareaFeedback");
      feedback.textContent = "";
      if (!mensaje) {
        feedback.style.color = "red";
        feedback.textContent = "Escribe un mensaje antes de enviar";
        return;
      }
      // Bloquea inmediatamente y cambia texto
      btnEnviar.disabled = true;
      const originalText = btnEnviar.textContent;
      btnEnviar.textContent = "Enviando…";

      try {
        const formData = new FormData();
        formData.append("seq", seq);
        formData.append("mensaje", mensaje);
        if (archivo) formData.append("archivoAdjunto", archivo);

        const res = await fetch("/api/enviar-paciente", {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        const json = await res.json();
        if (res.ok && json.success) {
          feedback.style.color = "green";
          feedback.textContent = "Mensaje enviado al paciente ✔";
          if (archivoInput) archivoInput.value = "";
          await cargarMensajePacienteGuardado();
        } else {
          feedback.style.color = "red";
          feedback.textContent = `Error: ${json.message || res.statusText}`;
        }
      } catch {
        feedback.style.color = "red";
        feedback.textContent = "Error de red al enviar";
      }
      setTimeout(() => {
        btnEnviar.disabled = false;
        btnEnviar.textContent = originalText;
      }, 3000);
    });
  }

  // --- 6) BLOQUEO Y LÓGICA RESTANTE ---
  let fecha1Bloqueada = false,
    fecha2Bloqueada = false;
  const rol = (localStorage.getItem("rol") || "").trim().toLowerCase();
  const rol_id = Number(localStorage.getItem("rol_id"));
  const userId = Number(localStorage.getItem("userId"));
  const camposSoloResp = [
    "respuesta_al_area_encargada",
    "respuesta_al_area_encargada_reasignacion",
    "fecha_respuesta_responsable",
    "fecha_respuesta_responsable_reasignacion",
  ];

  // --- FUNCIÓN BLOQUEO POR ROL Y ESTADO ---
  function bloquearCamposPorRolYEstado() {
    const est = (document.getElementById("estado")?.value || "")
      .trim()
      .toLowerCase();
    const saveBtn = document.querySelector(
      "#tipificarForm button[type=submit]"
    );
    const rol = (localStorage.getItem("rol") || "").trim().toLowerCase();
    const rol_id = Number(localStorage.getItem("rol_id"));

    // Admin (rol_id = 1): nunca bloquea nada
    if (rol_id === 1) {
      if (saveBtn) saveBtn.style.display = "";
      document.querySelectorAll("input, select, textarea").forEach((el) => {
        el.readOnly = false;
        el.disabled = false;
      });
      return;
    }

    // Si PQRS está RESUELTA
    if (est === "resuelta" || est === "finalizada") {
      if (rol_id === 2 || rol_id === 4) {
        document.querySelectorAll("input, select, textarea").forEach((el) => {
          if (el.id === "estado") {
            el.readOnly = false;
            el.disabled = false;
          } else {
            el.readOnly = true;
            el.disabled = true;
          }
        });
        if (saveBtn) saveBtn.style.display = "";
        return;
      } else {
        document.querySelectorAll("input, select, textarea").forEach((el) => {
          el.readOnly = true;
          el.disabled = true;
        });
        if (saveBtn) saveBtn.style.display = "none";
        return;
      }
    }

    // RESPONSABLE, NO RESUELTA: solo activa sus campos
    if (rol === "responsable" && rol_id === 3) {
      document.querySelectorAll("input, select, textarea").forEach((el) => {
        if (camposSoloResp.includes(el.id)) {
          el.readOnly = false;
          el.disabled = false;
        } else {
          el.readOnly = true;
          el.disabled = true;
        }
      });
      if (saveBtn) saveBtn.style.display = "";
      if (fecha1Bloqueada) {
        document.getElementById("fecha_respuesta_responsable").readOnly = true;
        document.getElementById("fecha_respuesta_responsable").disabled = true;
      }
      if (fecha2Bloqueada) {
        document.getElementById(
          "fecha_respuesta_responsable_reasignacion"
        ).readOnly = true;
        document.getElementById(
          "fecha_respuesta_responsable_reasignacion"
        ).disabled = true;
      }
      const subtip = document.getElementById("subtipologia");
      if (subtip) {
        subtip.readOnly = true;
        subtip.disabled = true;
      }
      return;
    }

    // Analista o agente, NO resuelta: solo bloquea campos de responsable
    if (
      rol === "analista" ||
      rol === "agente" ||
      rol_id === 2 ||
      rol_id === 4
    ) {
      camposSoloResp.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          el.readOnly = true;
          el.disabled = true;
        }
      });
      if (saveBtn) saveBtn.style.display = "";
      return;
    }

    document.querySelectorAll("input, select, textarea").forEach((el) => {
      el.readOnly = true;
      el.disabled = true;
    });
    if (saveBtn) saveBtn.style.display = "none";
  }

  async function cargarMensajePacienteGuardado() {
    if (!seq) return;
    try {
      const res = await fetch(`/api/respuesta/${seq}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      const guardadoDiv = document.getElementById("mensajePacienteGuardadoDiv");
      const textarea = document.getElementById("mensajePacienteGuardado");
      const fechaLabel = document.getElementById("fechaMensajePaciente");
      if (data.mensaje_paciente) {
        textarea.value = data.mensaje_paciente;
        fechaLabel.textContent =
          "Enviado el: " + formatoFechaDDMMYYYY_HHMM(data.fecha_envio_paciente);
        guardadoDiv.style.display = "";
        const etiqueta = document.getElementById("enviadoPorAnalista");
        if (etiqueta) {
          etiqueta.textContent = data.enviado_por_nombre
            ? `Enviado por: ${data.enviado_por_nombre}`
            : "";
        }
      } else {
        guardadoDiv.style.display = "none";
      }
    } catch (err) {}
  }

  async function cargarDatos() {
    if (!seq) {
      alert("No se especificó el SAC");
      return;
    }
    try {
      const res = await fetch(`/api/respuesta/${seq}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("No se pudo cargar información");
      const data = await res.json();

      [
        "fecha_limite_de_rta",
        "fecha_de_cierre",
        "fecha_respuesta_responsable",
        "fecha_respuesta_responsable_reasignacion",
      ].forEach((n) => {
        const inp = document.getElementById(n);
        if (inp && data[n]) inp.value = formatoFechaYYYYMMDD(data[n]);
      });
      const inpEnv = document.getElementById("enviado_at");
      if (inpEnv && data["enviado_at"]) {
        inpEnv.value = formatoFechaDDMMYYYY_HHMM(data["enviado_at"]);
      }
      if (data.fecha_respuesta_responsable) {
        fecha1Bloqueada = true;
        document.getElementById("fecha_respuesta_responsable").readOnly = true;
      }
      if (data.fecha_respuesta_responsable_reasignacion) {
        fecha2Bloqueada = true;
        document.getElementById(
          "fecha_respuesta_responsable_reasignacion"
        ).readOnly = true;
      }
      const campos = [
        "persona",
        "tipo",
        "documeto_paciente",
        "nombre",
        "sexo",
        "origen",
        "departamento",
        "municipio",
        "direccion",
        "celular",
        "correo",
        "descripcion",
        "medio",
        "eps",
        "analista",
        "area_encargada",
        "responsable",
        "tipo_de_requerimiento",
        "medio_de_contacto",
        "requerimiento_de_la_solicitud",
        "atribuible",
        "por_que",
        "indicador_ans",
        "estado",
        "observaciones",
        "pregunta_reasignacion",
        "respuesta_al_area_encargada",
        "respuesta_al_area_encargada_reasignacion",
        "vencido",
      ];
      campos.forEach((c) => {
        const el = document.getElementById(c);
        if (el) el.value = data[c] || "";
      });
      const link = document.getElementById("archivo_anexo");
      if (link) {
        if (data.archivo_ruta) {
          link.href = `/${data.archivo_ruta.replace(/\\/g, "/")}`;
          link.textContent = data.archivo_nombre || "Ver archivo";
        } else {
          link.textContent = "No hay archivo";
        }
      }
      if (data.tipo_de_servicio) {
        const ts = document.getElementById("tipo_de_servicio");
        ts.value = data.tipo_de_servicio;
        ts.dispatchEvent(new Event("change"));
        setTimeout(() => {
          const st = document.getElementById("subtipologia");
          if (st && data.subtipologia) {
            st.disabled = false;
            st.value = data.subtipologia;
          }
        }, 200);
      }
      const eo = document.getElementById("oportunidad_operativa");
      const er = document.getElementById("oportunidad_real");
      if (eo) {
        eo.value = diasEntre(
          data.fecha_limite_de_rta,
          data.fecha_respuesta_responsable
        )
          ? `${diasEntre(
              data.fecha_limite_de_rta,
              data.fecha_respuesta_responsable
            )} días`
          : "";
      }
      if (er) {
        er.value = diasEntre(data.fecha_de_cierre, data.enviado_at)
          ? `${diasEntre(data.fecha_de_cierre, data.enviado_at)} días`
          : "";
      }
      await cargarMensajePacienteGuardado();
      document
        .getElementById("pregunta_reasignacion")
        .dispatchEvent(new Event("change"));
      bloquearCamposPorRolYEstado();
      document
        .getElementById("estado")
        .addEventListener("change", bloquearCamposPorRolYEstado);

      // ---- ACTUALIZA AUTOMÁTICAMENTE VENCIDO ----
      actualizarVencidoAuto();
      document.getElementById("vencido").readOnly = true;
      document.getElementById("vencido").disabled = true;
    } catch (err) {
      alert("Error cargando datos: " + err.message);
    }
  }

  await cargarDatos();

  // Actualiza vencido y ans automáticamente al cambiar fechas
  document
    .getElementById("fecha_limite_de_rta")
    ?.addEventListener("change", () => {
      actualizarIndicadorANS();
      actualizarVencidoAuto();
    });
  document
    .getElementById("fecha_respuesta_responsable")
    ?.addEventListener("change", () => {
      actualizarIndicadorANS();
      actualizarVencidoAuto();
    });

  actualizarIndicadorANS();
  actualizarVencidoAuto();

  // --- BLOQUEO DE FECHA AUTOMÁTICO ---
  function hoy() {
    return new Date().toISOString().slice(0, 10);
  }
  function bloquearFecha1SiAplica() {
    const resp = document.getElementById("respuesta_al_area_encargada");
    const fecha = document.getElementById("fecha_respuesta_responsable");
    if (
      resp &&
      fecha &&
      !fecha1Bloqueada &&
      resp.value.trim() !== "" &&
      fecha.value === ""
    ) {
      fecha.value = hoy();
      fecha.readOnly = true;
      fecha.disabled = true;
      fecha1Bloqueada = true;
    }
  }
  function bloquearFecha2SiAplica() {
    const resp = document.getElementById(
      "respuesta_al_area_encargada_reasignacion"
    );
    const fecha = document.getElementById(
      "fecha_respuesta_responsable_reasignacion"
    );
    if (
      resp &&
      fecha &&
      !fecha2Bloqueada &&
      resp.value.trim() !== "" &&
      fecha.value === ""
    ) {
      fecha.value = hoy();
      fecha.readOnly = true;
      fecha.disabled = true;
      fecha2Bloqueada = true;
    }
  }
  document
    .getElementById("respuesta_al_area_encargada")
    ?.addEventListener("input", bloquearFecha1SiAplica);
  document
    .getElementById("respuesta_al_area_encargada_reasignacion")
    ?.addEventListener("input", bloquearFecha2SiAplica);

  // --- MOSTRAR/OCULTAR REASIGNACIÓN ---
  const preguntaReas = document.getElementById("pregunta_reasignacion");
  const grupoReas = document.getElementById("grupo_reasignacion");
  preguntaReas?.addEventListener("change", () => {
    if (preguntaReas.value === "SI") {
      grupoReas.style.display = "";
      document.getElementById(
        "respuesta_al_area_encargada_reasignacion"
      ).required = true;
      document.getElementById(
        "fecha_respuesta_responsable_reasignacion"
      ).required = true;
    } else {
      grupoReas.style.display = "none";
      const resp = document.getElementById(
        "respuesta_al_area_encargada_reasignacion"
      );
      const fecha = document.getElementById(
        "fecha_respuesta_responsable_reasignacion"
      );
      resp.required = false;
      resp.value = "";
      fecha.required = false;
      fecha.value = "";
    }
  });
  preguntaReas?.dispatchEvent(new Event("change"));

  // --- GUARDAR / ACTUALIZAR FORM ---
  document
    .getElementById("tipificarForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      document.getElementById("subtipologia").disabled = false;
      bloquearFecha1SiAplica();
      bloquearFecha2SiAplica();

      // Asegúrate de que vencido esté actualizado antes de guardar
      actualizarVencidoAuto();

      const payload = {};
      [
        "seq",
        "medio",
        "eps",
        "radicado",
        "analista",
        "area_encargada",
        "responsable",
        "tipo_de_requerimiento",
        "tipo_de_servicio",
        "subtipologia",
        "medio_de_contacto",
        "requerimiento_de_la_solicitud",
        "atribuible",
        "por_que",
        "fecha_limite_de_rta",
        "respuesta_al_area_encargada",
        "indicador_ans",
        "estado",
        "oportunidad_real",
        "oportunidad_operativa",
        "fecha_de_cierre",
        "observaciones",
        "fecha_respuesta_responsable",
        "pregunta_reasignacion",
        "respuesta_al_area_encargada_reasignacion",
        "fecha_respuesta_responsable_reasignacion",
        "vencido",
      ].forEach((c) => {
        const el = document.getElementById(c);
        payload[c] = el ? (el.value !== "" ? el.value : null) : null;
      });

      const overlay = document.getElementById("loadingOverlay");
      overlay.style.display = "flex";

      try {
        const res = await fetch("/api/tipificar", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          mostrarToast("Tipificación guardada correctamente");
          setTimeout(() => {
            overlay.style.display = "none";
            window.location.href = "/dashboard/index.html";
          }, 1000);
          return;
        } else {
          overlay.style.display = "none";
          const err = await res.json();
          alert("Error: " + (err.message || res.statusText));
        }
      } catch (err) {
        overlay.style.display = "none";
        alert("No se pudo guardar la tipificación");
        console.error(err);
      }
    });

  document.getElementById("cancelBtn")?.addEventListener("click", () => {
    window.location.href = "/dashboard/index.html";
  });
});

function mostrarToast(mensaje, tiempo = 2500) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = mensaje;
  toast.className = "show";
  toast.style.display = "block";
  setTimeout(() => {
    toast.className = "";
    toast.style.display = "none";
  }, tiempo);
}
