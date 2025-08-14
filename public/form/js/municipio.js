async function cargarMunicipios() {
  // OJO: el path es relativo al servidor, /files/colombia.min.json
  const res = await fetch("/files/colombia.min.json");
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
  return await res.json();
}

async function initMunicipios() {
  let datos;
  try {
    datos = await cargarMunicipios();
  } catch (e) {
    console.error("Error cargando municipios:", e);
    return;
  }

  // --- Agrupar por nombre exacto de departamento ---
  const agrupado = datos.reduce((acc, { departamento, ciudades }) => {
    acc[departamento] = ciudades; // Key igual al value del <option>
    return acc;
  }, {});

  const selectDepto = document.getElementById("departamento");
  const selectMunicipio = document.getElementById("municipio");

  function actualizarMunicipios() {
    const depto = selectDepto.value;
    selectMunicipio.innerHTML = '<option value="">Selecciona...</option>';
    (agrupado[depto] || []).forEach(mun => {
      const opt = document.createElement("option");
      opt.value = mun; // El value es igual al nombre real
      opt.textContent = mun;
      selectMunicipio.appendChild(opt);
    });

    // Opción "Otro" al final
    const optOtro = document.createElement("option");
    optOtro.value = "Otro";
    optOtro.textContent = "Otro";
    selectMunicipio.appendChild(optOtro);
  }

  selectDepto.addEventListener("change", actualizarMunicipios);

  // Si hay valor inicial seleccionado (por validaciones), actualiza al cargar:
  actualizarMunicipios();
}

document.addEventListener("DOMContentLoaded", initMunicipios);
