// public/dashboard/js/main.js

document.addEventListener("DOMContentLoaded", () => {
  const links = document.querySelectorAll(".menu a");
  const contenido = document.getElementById("contenido");
  const logoutBtn = document.getElementById("logoutBtn");
  const rol_id = localStorage.getItem("rol_id");

  // --- Control de menú según rol ---
  if (rol_id === "3") {
    links.forEach((link) => {
      const f = link.dataset.file;
      if (f === "index.html" || f === "reporte.html") {
        link.style.display = "none";
      }
    });
  }

  logoutBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    localStorage.removeItem("rol");
    localStorage.removeItem("rol_id");
    localStorage.removeItem("userId");
    window.location.href = "/auth/index.html";
  });

  if (document.getElementById("tipificarForm")) return;

  const estados = {
    "index.html": "PENDIENTE",
    "gestion.html": "EN GESTION",
    "finalizadas.html": "RESUELTA",
  };

  // FUNCIONES DE VISTAS
  let vistaActual = "index.html";
  function loadView(link) {
    links.forEach((l) => l.classList.remove("activo"));
    link.classList.add("activo");
    const file = link.dataset.file;
    vistaActual = file;

    fetch(`/dashboard/componentes/${file}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((html) => {
        contenido.innerHTML = html;
        contenido.classList.remove("fade-slide-in");
        void contenido.offsetWidth;
        contenido.classList.add("fade-slide-in");

        // SOLO en reporte.html: asignar manejadores a los filtros y controlar visibilidad de tabla
        const filtroDocumento = document.getElementById("filtroDocumento");
        const filtroCorreo = document.getElementById("filtroCorreo");
        const btnBuscar = document.getElementById("btnBuscar");
        const btnLimpiar = document.getElementById("btnLimpiar");
        const tabla = document.getElementById("tablaRespuestas");
        const paginacion = document.getElementById("paginacion");

        if (
          file === "reporte.html" &&
          btnBuscar &&
          filtroDocumento &&
          filtroCorreo
        ) {
          // Al cargar, oculta tabla y paginación
          if (tabla) tabla.style.display = "none";
          if (paginacion) paginacion.style.display = "none";

          btnBuscar.onclick = () => {
            const doc = filtroDocumento.value.trim();
            const correo = filtroCorreo.value.trim();
            const fechaDesde =
              document.getElementById("filtroFechaDesde")?.value || "";
            const fechaHasta =
              document.getElementById("filtroFechaHasta")?.value || "";

            // Validación de rango de fechas
            if (fechaDesde && fechaHasta) {
              if (new Date(fechaDesde) > new Date(fechaHasta)) {
                alert(
                  "La fecha 'Desde' no puede ser posterior a la fecha 'Hasta'."
                );
                return;
              }
            }

            if (doc !== "" || correo !== "" || fechaDesde || fechaHasta) {
              if (tabla) tabla.style.display = "";
              if (paginacion) paginacion.style.display = "";
              renderTable("reporte.html", {
                doc,
                correo,
                fechaDesde,
                fechaHasta,
              });
            } else {
              if (tabla) tabla.style.display = "none";
              if (paginacion) paginacion.style.display = "none";
              if (tabla) tabla.querySelector("tbody").innerHTML = "";
              if (paginacion) paginacion.innerHTML = "";
              alert(
                "Debe ingresar al menos un filtro (documento, correo o rango de fechas)."
              );
            }
          };

          btnLimpiar.onclick = () => {
            filtroDocumento.value = "";
            filtroCorreo.value = "";
            if (tabla) tabla.style.display = "none";
            if (paginacion) paginacion.style.display = "none";
            if (tabla) tabla.querySelector("tbody").innerHTML = "";
            if (paginacion) paginacion.innerHTML = "";
          };
        } else {
          // Para otras vistas, carga tabla como siempre
          if (estados[file]) renderTable(file);
        }

        if (file === "finalizadas.html") initSeqFilter();
        if (file === "reporte.html" && window.cargarEstadisticas)
          cargarEstadisticas();
        if (file === "reporte.html" && window.initCrearUsuarios)
          initCrearUsuarios();
        if (file === "reporte.html" && window.initEditarUsuario)
          initEditarUsuario();
      })
      .catch((err) => {
        contenido.innerHTML = `<p>Error al cargar ${file}: ${err}</p>`;
      });
  }

  function renderTable(file, filtros = {}) {
    const tableId =
      file === "gestion.html"
        ? "#tablaRespuestasGestion"
        : file === "finalizadas.html"
        ? "#tablaRespuestasFinalizadas"
        : "#tablaRespuestas";
    const pagId =
      file === "gestion.html"
        ? "#paginacionGestion"
        : file === "finalizadas.html"
        ? "#paginacionFinalizadas"
        : "#paginacion";

    const PAGE = 5;
    let offset = 0;
    let firstLoad = false; // ya no salta a la última página en finalizadas.html

    function cargar() {
      const table = document.querySelector(tableId);
      const pagDiv = document.querySelector(pagId);
      if (!table || !pagDiv) return;

      // Construir URL con filtros
      let url = `/api/respuestas?limit=${PAGE}&offset=${offset}`;
      if (estados[file]) url += `&estado=${encodeURIComponent(estados[file])}`;
      if (file === "reporte.html" && filtros.doc)
        url += `&documeto_paciente=${encodeURIComponent(filtros.doc)}`;
      if (file === "reporte.html" && filtros.correo)
        url += `&correo=${encodeURIComponent(filtros.correo)}`;
      if (file === "reporte.html" && filtros.fechaDesde)
        url += `&fecha_desde=${encodeURIComponent(filtros.fechaDesde)}`;
      if (file === "reporte.html" && filtros.fechaHasta)
        url += `&fecha_hasta=${encodeURIComponent(filtros.fechaHasta)}`;

      fetch(url, { credentials: "include" })
        .then((r) => {
          if (r.status === 401) location.href = "/auth/index.html";
          return r.ok ? r.json() : Promise.reject(r.status);
        })
        .then(({ total, data }) => {
          if (firstLoad) {
            firstLoad = false;
            offset = Math.max(0, total - PAGE);
            return cargar();
          }

          const tbody = table.querySelector("tbody");
          tbody.innerHTML = "";

          data.forEach((r) => {
            const tr = document.createElement("tr");

            // Vencimiento y círculo
            let idClass = "";
            let showCircle = false;
            if (
              (file === "gestion.html" ||
                (file === "reporte.html" && (filtros.doc || filtros.correo))) &&
              r.fecha_limite_de_rta
            ) {
              const limite = new Date(r.fecha_limite_de_rta);
              const limiteReal = new Date(
                limite.getTime() + 24 * 60 * 60 * 1000
              );
              const ahora = new Date();
              const diffH = (limiteReal - ahora) / 36e5;
              if (diffH < 0) {
                idClass = "celda-overdue";
                showCircle = true;
              } else if (diffH <= 14) {
                idClass = "celda-warning";
                showCircle = true;
              }
            }

            let circleHtml = "";
            if (showCircle && idClass) {
              circleHtml = `<span class="circle-bg ${
                idClass === "celda-overdue"
                  ? "circle-overdue-bg"
                  : "circle-warning-bg"
              }"></span>`;
            }

            tr.innerHTML = `
            <td class="id-bg-circle-cell">
              <span class="id-label-foreground">SAC-${r.seq}</span>
              ${circleHtml}
            </td>
            <td>${r.persona}</td>
            <td>${r.tipo}</td>
            <td>${r.documeto_paciente}</td>
            <td>${r.nombre}</td>
            <td>${r.correo}</td>
            <td>${new Date(r.enviado_at).toLocaleString()}</td>
            <td><button class="action-btn" data-seq="${
              r.seq
            }">Tipificar</button></td>
          `;

            tbody.appendChild(tr);
          });

          tbody.querySelectorAll(".action-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
              location.href = `/dashboard/componentes/tipificar.html?seq=${btn.dataset.seq}`;
            });
          });

          // Paginación robusta
          pagDiv.innerHTML = "";
          const totalPages = Math.max(1, Math.ceil(total / PAGE));
          const currentPage = Math.min(
            Math.floor(offset / PAGE) + 1,
            totalPages
          );
          const lastOffset = (totalPages - 1) * PAGE;

          const prev = document.createElement("button");
          prev.textContent = "Anterior";
          prev.disabled = offset === 0;
          prev.onclick = () => {
            offset = Math.max(0, offset - PAGE);
            cargar();
          };

          const next = document.createElement("button");
          next.textContent = "Siguiente";
          next.disabled = offset >= lastOffset;
          next.onclick = () => {
            offset = Math.min(offset + PAGE, lastOffset);
            cargar();
          };

          pagDiv.append(prev);
          const label = document.createElement("span");
          label.textContent = ` Página ${currentPage} de ${totalPages} `;
          pagDiv.append(label);
          pagDiv.append(next);
        })
        .catch((err) => {
          pagDiv.innerHTML = `<p>Error: ${err}</p>`;
        });
    }
    cargar();
  }

  function initSeqFilter() {
    const input = document.getElementById("inputSeqFilter");
    const btnF = document.getElementById("btnFiltrar");
    const btnL = document.getElementById("btnLimpiarFiltro");
    if (!input || !btnF || !btnL) return;

    btnF.addEventListener("click", () => {
      const val = input.value.trim();
      if (!val) return;
      fetch(`/api/respuesta/${encodeURIComponent(val)}`, {
        credentials: "include",
      })
        .then(async (r) => {
          if (r.status === 404) throw "No encontrado";
          if (r.status === 403) throw "No autorizado para ver este caso";
          if (!r.ok) throw "Error de servidor";
          return r.json();
        })
        .then((data) => {
          const tbody = document.querySelector(
            "#tablaRespuestasFinalizadas tbody"
          );
          tbody.innerHTML = "";

          const tr = document.createElement("tr");

          // Determinar vencimiento y círculo
          let idClass = "";
          let showCircle = false;
          if (data.fecha_limite_de_rta) {
            const limite = new Date(data.fecha_limite_de_rta);
            const limiteReal = new Date(limite.getTime() + 24 * 60 * 60 * 1000);
            const ahora = new Date();
            const diffH = (limiteReal - ahora) / 36e5;
            if (diffH < 0) {
              idClass = "celda-overdue";
              showCircle = true;
            } else if (diffH <= 14) {
              idClass = "celda-warning";
              showCircle = true;
            }
          }
          let circleHtml = "";
          if (showCircle && idClass) {
            circleHtml = `<span class="circle-bg ${
              idClass === "celda-overdue"
                ? "circle-overdue-bg"
                : "circle-warning-bg"
            }"></span>`;
          }

          tr.innerHTML = `
    <td class="id-bg-circle-cell" data-label="ID">
      <span class="id-label-foreground"><strong>SAC-${data.seq}</strong></span>
      ${circleHtml}
    </td>
    <td data-label="Persona">${data.persona}</td>
    <td data-label="Tipo">${data.tipo}</td>
    <td data-label="Documento">${data.documeto_paciente}</td>
    <td data-label="Nombre">${data.nombre}</td>
    <td data-label="Correo">${data.correo}</td>
    <td data-label="Fecha">${new Date(data.enviado_at).toLocaleString()}</td>
    <td data-label="Acción">
      <button class="action-btn" data-seq="${data.seq}">Tipificar</button>
    </td>
  `;

          tbody.appendChild(tr);

          const rol_id = localStorage.getItem("rol_id");
          const userId = Number(localStorage.getItem("userId"));

          const btn = tbody.querySelector(".action-btn");
          if (rol_id === "3" && Number(data.responsable) !== userId) {
            btn.disabled = true;
            btn.title = "No tienes permisos para tipificar este caso";
            btn.classList.add("disabled-btn");
          } else {
            btn.disabled = false;
            btn.title = "";
            btn.classList.remove("disabled-btn");
            btn.addEventListener("click", () => {
              window.location = `/dashboard/componentes/tipificar.html?seq=${data.seq}`;
            });
          }

          document.getElementById("paginacionFinalizadas").innerHTML = "";
        })
        .catch((err) => {
          alert(`Error: ${err}`);
          const tbody = document.querySelector(
            "#tablaRespuestasFinalizadas tbody"
          );
          tbody.innerHTML = "";
          document.getElementById("paginacionFinalizadas").innerHTML = "";
        });
    });

    btnL.addEventListener("click", () => {
      input.value = "";
      renderTable("finalizadas.html");
    });
  }

  // --- INICIALIZA ---
  const first =
    Array.from(links).find((l) => l.style.display !== "none") || links[0];
  if (first) loadView(first);
  links.forEach((link) => {
    link.addEventListener("click", (e) => {
      if (link.style.display === "none") return;
      e.preventDefault();
      loadView(link);
    });
  });
});
