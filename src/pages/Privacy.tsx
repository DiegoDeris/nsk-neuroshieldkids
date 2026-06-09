import { Link } from "react-router-dom";
import { Logo } from "@/components/Logo";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-white">
      <header className="container py-5 flex items-center justify-between">
        <Logo />
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-900">← Volver</Link>
      </header>
      <main className="container max-w-3xl py-10 prose prose-slate">
        <h1>Política de Privacidad</h1>
        <p className="text-slate-500 text-sm">Última actualización: junio 2025</p>

        <h2>1. Responsable del tratamiento</h2>
        <p>
          NSK (en adelante, "nosotros") es el responsable del tratamiento de los datos personales
          recogidos a través de esta aplicación. Puedes contactarnos en{" "}
          <a href="mailto:privacidad@nsk.app">privacidad@nsk.app</a>.
        </p>

        <h2>2. Datos que recogemos</h2>
        <p>Recogemos los siguientes datos:</p>
        <ul>
          <li><strong>Datos de cuenta:</strong> dirección de correo electrónico y contraseña cifrada.</li>
          <li><strong>Perfiles de hijos:</strong> nombre, edad, género y dispositivos vinculados.</li>
          <li><strong>Datos de uso del dispositivo:</strong> aplicaciones usadas, tiempo de pantalla y categorías de contenido, recogidos por la app Android instalada en el dispositivo del menor.</li>
          <li><strong>Alertas y métricas:</strong> patrones de uso, puntuaciones emocionales calculadas por IA y recomendaciones generadas.</li>
          <li><strong>Datos de pago:</strong> gestionados íntegramente por Stripe; no almacenamos datos de tarjeta.</li>
        </ul>

        <h2>3. Finalidad y base jurídica</h2>
        <ul>
          <li><strong>Prestación del servicio</strong> (Art. 6.1.b RGPD): procesar datos de uso para ofrecer las funciones de monitoreo, alertas y recomendaciones.</li>
          <li><strong>Interés legítimo</strong> (Art. 6.1.f RGPD): mejorar la seguridad y la calidad del servicio.</li>
          <li><strong>Consentimiento</strong> (Art. 6.1.a RGPD): para el análisis de emociones basado en IA.</li>
          <li><strong>Obligación legal</strong> (Art. 6.1.c RGPD): conservación de datos de facturación.</li>
        </ul>

        <h2>4. Datos de menores</h2>
        <p>
          NSK está diseñado para que los padres o tutores legales monitoreen dispositivos de sus hijos.
          Tratamos datos de menores exclusivamente bajo la responsabilidad parental y en cumplimiento del
          Art. 8 RGPD y la normativa local aplicable. No vendemos ni cedemos datos de menores a terceros.
        </p>

        <h2>5. Transferencias internacionales</h2>
        <p>
          Los datos se almacenan en servidores de Supabase (UE) y se procesan puntualmente por la API
          de Google Gemini (EEUU), amparada en las Cláusulas Contractuales Tipo aprobadas por la Comisión
          Europea. Los pagos se procesan por Stripe (EEUU), bajo las mismas garantías.
        </p>

        <h2>6. Conservación de datos</h2>
        <p>
          Los datos de uso se conservan durante 12 meses desde su generación. Los datos de cuenta se
          conservan mientras la cuenta esté activa y se eliminan íntegramente al ejercer el derecho de
          supresión o al cerrar la cuenta.
        </p>

        <h2>7. Tus derechos (RGPD Arts. 15–22)</h2>
        <p>Puedes ejercer en cualquier momento los derechos de:</p>
        <ul>
          <li><strong>Acceso</strong> a tus datos personales.</li>
          <li><strong>Rectificación</strong> de datos inexactos.</li>
          <li><strong>Supresión</strong> («derecho al olvido»): eliminar tu cuenta borra irreversiblemente todos tus datos.</li>
          <li><strong>Portabilidad</strong>: exporta todos tus datos en formato JSON desde Mi Cuenta.</li>
          <li><strong>Oposición y limitación</strong> del tratamiento.</li>
        </ul>
        <p>
          Para ejercer cualquiera de estos derechos, escríbenos a{" "}
          <a href="mailto:privacidad@nsk.app">privacidad@nsk.app</a> o utiliza las opciones de
          exportación y eliminación disponibles en{" "}
          <Link to="/account">Mi Cuenta</Link>.
        </p>
        <p>
          Si consideras que el tratamiento vulnera el RGPD, puedes presentar una reclamación ante la
          Agencia Española de Protección de Datos (AEPD) en{" "}
          <a href="https://www.aepd.es" target="_blank" rel="noopener noreferrer">www.aepd.es</a>.
        </p>

        <h2>8. Cookies</h2>
        <p>
          Esta aplicación no utiliza cookies de seguimiento ni publicidad. Únicamente se almacena en
          el navegador la sesión de autenticación necesaria para el funcionamiento del servicio.
        </p>

        <h2>9. Cambios en esta política</h2>
        <p>
          Cualquier cambio relevante se notificará por correo electrónico con al menos 30 días de
          antelación. La versión actualizada siempre estará disponible en esta página.
        </p>

        <h2>10. Contacto</h2>
        <p>
          Para cualquier consulta sobre privacidad:{" "}
          <a href="mailto:privacidad@nsk.app">privacidad@nsk.app</a>
        </p>
      </main>
      <footer className="container py-8 text-center text-sm text-slate-400">
        © {new Date().getFullYear()} NSK ·{" "}
        <Link to="/privacy" className="hover:underline">Política de privacidad</Link>
      </footer>
    </div>
  );
}
