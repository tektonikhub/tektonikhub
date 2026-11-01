---
name: blk-design-system
description: >-
  Standardized design system, typography, color tokens, layout structures, and UI component
  specifications for Tektonik hub web pages (Admin, Catalog, Profile, Creator, Dashboard).
  Use this skill whenever building or styling pages in the Tektonik hub platform to guarantee
  visual consistency, shared CSS variables, and layout formatting.
---

# Tektonik hub — Design System & Style Guide

Esta skill define de forma exhaustiva los estándares de diseño, maquetación, tokens CSS, componentes y formatos de interfaz establecidos en `admin.html` para toda la plataforma **Tektonik hub**.

---

## 1. Tokens de Diseño Globales (CSS Custom Properties)

Todas las páginas de la plataforma deben declarar y consumir las variables CSS corporativas estándar en `:root`:

```css
:root {
  /* ── Paleta de Color Corporativa ── */
  --bg:           #EFEFEB;  /* Fondo neutro cálido de página */
  --bg-2:         #E4E4DF;  /* Fondo alternativo / inputs */
  --card:         #FFFFFF;  /* Fondo de tarjetas y paneles */
  --fg:           #111111;  /* Texto principal y bordes fuertes */
  --fg-soft:      #444444;  /* Texto secundario y descripciones */
  --muted:        #777777;  /* Metadatos y etiquetas secundarias */
  --line:         #E2E2DE;  /* Bordes, divisores y contornos */
  --accent:       #FEFF44;  /* Acento característico Tektonik hub (amarillo eléctrico) */
  --accent-on:    #111111;  /* Color de texto sobre el acento */

  /* ── Estados Semánticos ── */
  --green:        #0B7A48;  /* Aprobado, SOC2 Pass, 100% compliance */
  --green-bg:     #E8F5EE;  /* Fondo suave para badges verdes */
  --amber:        #B45309;  /* Pendiente, alerta, revisión CISO */
  --amber-bg:     #FEF3C7;  /* Fondo suave para badges ámbar */
  --red:          #B91C1C;  /* Rechazado, alerta de seguridad */
  --red-bg:       #FEE2E2;  /* Fondo suave para badges rojos */
  --blue:         #1D4ED8;  /* Información, links, nuevas apps */
  --blue-bg:      #EFF6FF;

  /* ── Tipografía ── */
  --display-font: 'Barlow', system-ui, -apple-system, sans-serif;
  --body-font:    'DM Sans', system-ui, -apple-system, sans-serif;
  --mono-font:    'JetBrains Mono', monospace;

  /* ── Geometría y Layout ── */
  --r-card:       16px;     /* Radio de tarjetas principales */
  --r-sm:         8px;      /* Radio de botones, chips y badges */
  --sidebar-w:    260px;    /* Ancho estándar del sidebar */
  --topbar-h:     60px;     /* Altura estándar de la barra superior */
  --shadow:       0 8px 24px -10px rgba(0,0,0,.08);
  --shadow-lg:    0 20px 40px rgba(0,0,0,.16);
}
```

### Fuentes Tipográficas Requeridas
Incluir siempre en el `<head>`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:ital,wght@0,700;0,800;1,900&family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700;800&display=swap" rel="stylesheet">
```

---

## 2. Anatomía de Página Estándar (App Shell)

Tanto `admin.html` como `app-catalog.html` utilizan una arquitectura de **App Shell** fija a viewport:

```html
<body>
  <!-- 1. Top Bar fija (60px) -->
  <header class="top-bar">
    <div class="top-left">
      <div class="brand-logo">TH</div>
      <div class="org-title">
        <span>Via Rapida</span>
        <span class="badge-admin">ORG ADMIN / CATALOG</span>
      </div>
    </div>
    <div class="top-center">
      <!-- Buscador unificado con atajo ⌘K -->
    </div>
    <div class="top-right">
      <!-- Botones de navegación contextual + Perfil de usuario -->
    </div>
  </header>

  <!-- 2. Cuerpo dividido: Sidebar + Main Content -->
  <div class="app-body">
    <aside class="sidebar">
      <!-- Secciones de navegación con nav-label y nav-btn -->
      <div class="sidebar-footer">
        <!-- Info corporativa muted -->
      </div>
    </aside>

    <main class="main-content">
      <!-- Contenido scrollable -->
    </main>
  </div>

  <!-- 3. Toast flotante bottom-right -->
  <div class="toast" id="toast"></div>
</body>
```

Reglas CSS clave para el body:
```css
html, body {
  height: 100%;
  overflow: hidden;
}
body {
  display: flex;
  flex-direction: column;
}
.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 28px 36px 60px;
}
```

---

## 3. Componentes y Patrones UI Canónicos

### 3.1. Logotipo Tektonik hub
```html
<div class="brand-logo">TH</div>
```
```css
.brand-logo {
  width: 32px;
  height: 32px;
  background: #111;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-family: var(--display-font);
  font-weight: 900;
  font-size: 14px;
  color: var(--accent);
}
```

### 3.2. Badge de Rol / Contexto
```html
<span class="badge-admin">CATÁLOGO</span>
```
```css
.badge-admin {
  background: #111;
  color: var(--accent);
  font-family: var(--mono-font);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 4px;
  letter-spacing: .04em;
  text-transform: uppercase;
}
```

### 3.3. Botones de Navegación del Sidebar
```html
<div class="nav-label">Áreas Funcionales</div>
<button class="nav-btn active" onclick="filterByArea('all', this)">
  <span class="left">
    <svg class="ico" viewBox="0 0 24 24">...</svg>
    Todas las áreas
  </span>
  <span class="nav-badge">24</span>
</button>
```
```css
.nav-label {
  font-family: var(--mono-font);
  font-size: 10px;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: .08em;
  padding: 10px 10px 4px;
}
.nav-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 12px;
  border-radius: 9px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--fg-soft);
  text-align: left;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: all .12s ease;
}
.nav-btn:hover {
  background: var(--bg);
  color: var(--fg);
}
.nav-btn.active {
  background: #111;
  color: #fff;
}
.nav-btn.active .nav-badge {
  background: var(--accent);
  color: #111;
}
```

### 3.4. Tarjeta de Micro-App (App Card)
Cada aplicación o elemento del catálogo comparte el formato card de `admin.html`:
```html
<article class="review-card">
  <div class="card-top">
    <div class="author-info">
      <div class="author-avatar">ML</div>
      <div>
        <div class="author-name">Marc Lleb (@lleb)</div>
        <div class="author-sub">Finanzas · ERP Ops</div>
      </div>
    </div>
    <span class="status-stamp approved">✓ SOC2 PASS</span>
  </div>

  <div>
    <div class="app-title">
      InvoiceMatcher Pro
      <span class="cat-chip">Finanzas</span>
    </div>
    <p class="app-desc">Conciliación automática a 3 bandas de facturas recibidas contra SAP ERP.</p>
  </div>

  <div class="meta-row">
    <div class="meta-item"><b>IA:</b> Claude 3.7 Sonnet</div>
    <div class="meta-item"><b>Impacto:</b> 32h/semana</div>
    <div class="meta-item">
      <b>Ficheros:</b>
      <div class="chips-group">
        <span class="file-chip">index.html</span>
        <span class="file-chip">sap-rules.json</span>
      </div>
    </div>
  </div>

  <div class="card-actions">
    <button class="btn-act btn-changes">Detalles</button>
    <button class="btn-act btn-approve">Ejecutar Sandbox</button>
  </div>
</article>
```
Estilos CSS:
```css
.review-card {
  background: var(--card);
  border: 1.5px solid var(--line);
  border-radius: var(--r-card);
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: all .15s ease;
}
.review-card:hover {
  border-color: #111;
  box-shadow: var(--shadow);
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  font-size: 12.5px;
  padding: 10px 14px;
  background: var(--bg);
  border-radius: var(--r-sm);
}
.btn-act {
  font-size: 12.5px;
  font-weight: 700;
  padding: 8px 16px;
  border-radius: var(--r-sm);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  border: none;
  transition: all .15s ease;
}
```

### 3.5. Estados y Sellos de Cumplimiento (Status Stamps)
```css
.status-stamp {
  font-family: var(--mono-font);
  font-size: 10.5px;
  font-weight: 800;
  padding: 3px 9px;
  border-radius: 6px;
  letter-spacing: .04em;
}
.status-stamp.approved { background: var(--green-bg); color: var(--green); border: 1px solid #c2eed1; }
.status-stamp.waiting  { background: var(--amber-bg); color: var(--amber); border: 1px solid #fde68a; }
.status-stamp.rejected { background: var(--red-bg); color: var(--red); border: 1px solid #fecaca; }
```

### 3.6. Sistema de Toast Flotante
```css
.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: #111;
  color: #fff;
  padding: 10px 18px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  opacity: 0;
  transform: translateY(12px);
  transition: all .2s ease;
  z-index: 200;
  pointer-events: none;
}
.toast.show {
  opacity: 1;
  transform: translateY(0);
}
```

---

## 4. Soporte Dinámico de Marca Compartida (Dynamic Brand Settings)

Toda página dentro del dominio de la empresa (como `app-catalog.html`) debe escuchar e inyectar automáticamente los tokens de CSS personalizados guardados desde `admin.html`:

```javascript
document.addEventListener('DOMContentLoaded', () => {
  try {
    const saved = localStorage.getItem('blk_viarapida_css_tokens');
    if (saved) {
      const tokens = JSON.parse(saved);
      const styleTag = document.createElement('style');
      styleTag.id = 'dynamic-brand-styles';
      styleTag.textContent = `
        :root {
          --accent: ${tokens.accent} !important;
          --bg: ${tokens.bg} !important;
          --card: ${tokens.card} !important;
          --fg: ${tokens.fg} !important;
          --fg-soft: ${tokens.fgSoft} !important;
          --line: ${tokens.line} !important;
          --green: ${tokens.green} !important;
          --amber: ${tokens.amber} !important;
          --display-font: ${tokens.displayFont} !important;
          --body-font: ${tokens.bodyFont} !important;
          --r-card: ${tokens.rCard} !important;
          --r-sm: ${tokens.rSm} !important;
        }
      `;
      document.head.appendChild(styleTag);
    }
  } catch (e) {}
});
```

---

## 5. Checklist de Verificación al Crear o Refactorizar Páginas
- [ ] ¿Usa las fuentes oficiales Barlow (titulares), DM Sans (cuerpo) y JetBrains Mono (código y metadatos)?
- [ ] ¿El layout respeta la barra superior de 60px y el sidebar de 260px con scroll independiente?
- [ ] ¿Los botones usan `font-family: var(--body-font)` y bordes `var(--r-sm)`?
- [ ] ¿Las cards de herramientas incluyen autor con avatar circular, sellos de cumplimiento y metadatos con fondo `--bg`?
- [ ] ¿El toast aparece en la esquina inferior derecha (`bottom: 24px; right: 24px`)?
- [ ] ¿Carga los tokens dinámicos de `localStorage` para reflejar la personalización de la organización?
