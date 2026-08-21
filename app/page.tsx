"use client";

import { Box, Check, Combine, Download, FileArchive, Languages, Pentagon, ShieldCheck, Spline, WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { getCopy, storedLanguage, storedTheme } from "./lib/i18n";
import type { Language } from "./lib/i18n";

// Símbolo geométrico nativo da marca; o texto segue a fonte já carregada pelo app.
function BrandLockup({ height = 34 }: { height?: number }) {
  return <span className="brand-lockup" role="img" aria-label="Poligome">
    <svg viewBox="0 0 40 40" height={height} aria-hidden="true">
      <path d="M20 2 35 11v18L20 38 5 29V11z" fill="currentColor" />
      <path d="m14 13 12 7-12 7z" fill="var(--surface)" />
    </svg>
    <strong>Poligome</strong>
  </span>;
}

const LANGUAGES: Array<{ id: Language; name: string; code: string }> = [
  { id: "pt", name: "Português", code: "PT-BR" },
  { id: "en", name: "English", code: "EN" },
  { id: "fr", name: "Français", code: "FR" },
  { id: "es", name: "Español", code: "ES" },
];

export default function Landing() {
  // Começa no mesmo idioma que o servidor renderizou, para a hidratação casar, e adota a
  // preferência salva um quadro depois. O conteúdo vai inteiro no HTML: a landing precisa
  // ser legível por buscadores e sem JavaScript.
  const [language, setLanguage] = useState<Language>("pt");
  const copy = getCopy(language);

  useEffect(() => {
    document.documentElement.dataset.theme = storedTheme();
    const stored = storedLanguage();
    if (stored === "pt") return;
    const frame = window.requestAnimationFrame(() => setLanguage(stored));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "pt" ? "pt-BR" : language;
    document.title = copy.appTitle;
  }, [copy.appTitle, language]);

  // Só a escolha explícita do usuário é gravada; o efeito acima não deve sobrescrever
  // uma preferência existente com o "pt" do primeiro render.
  function chooseLanguage(next: Language) {
    setLanguage(next);
    localStorage.setItem("poligome-language", next);
  }

  const features = [
    { icon: <Box size={19} />, title: copy.landingFeatShapesTitle, text: copy.landingFeatShapesText },
    { icon: <WandSparkles size={19} />, title: copy.landingFeatSamTitle, text: copy.landingFeatSamText },
    { icon: <Combine size={19} />, title: copy.landingFeatVectorTitle, text: copy.landingFeatVectorText },
    { icon: <Download size={19} />, title: copy.landingFeatExportTitle, text: copy.landingFeatExportText },
    { icon: <FileArchive size={19} />, title: copy.landingFeatProjectTitle, text: copy.landingFeatProjectText },
    { icon: <Spline size={19} />, title: copy.landingFeatWorkspaceTitle, text: copy.landingFeatWorkspaceText },
  ];

  return <main className="landing">
    <header className="landing-top">
      <BrandLockup height={30} />
      <nav className="landing-langs" aria-label={copy.landingLanguageLabel}>
        <Languages size={15} aria-hidden="true" />
        {LANGUAGES.map((item) => <button
          key={item.id}
          className={language === item.id ? "active" : ""}
          aria-pressed={language === item.id}
          title={item.code}
          onClick={() => chooseLanguage(item.id)}
        >{item.name}</button>)}
      </nav>
    </header>

    <section className="landing-hero">
      <p className="landing-eyebrow"><Pentagon size={13} aria-hidden="true" />{copy.landingEyebrow}</p>
      <h1>{copy.landingHeadline}</h1>
      <p className="landing-intro">{copy.landingIntro}</p>
      <div className="landing-actions">
        <a className="landing-cta" href="/anotar">{copy.landingCta}</a>
        <a className="landing-cta secondary" href="/texto">LLM / Text Annotation</a>
        <span className="landing-free-badge"><Check size={13} aria-hidden="true" />{copy.landingBadgeFree}</span>
      </div>
      <p className="landing-cta-note">{copy.landingCtaNote}</p>
    </section>

    <section className="landing-projects" aria-label="Tipos de projeto">
      <a href="/anotar"><Box size={20} /><div><b>Computer Vision</b><span>Imagens, polígonos, máscaras e bounding boxes.</span></div><span>→</span></a>
      <a href="/texto"><FileArchive size={20} /><div><b>LLM / Text</b><span>Classificação, avaliação, comparação e correção de respostas.</span></div><span>→</span></a>
    </section>

    <section className="landing-claims">
      <article>
        <span className="landing-claim-mark"><Check size={17} aria-hidden="true" /></span>
        <div><h2>{copy.landingFreeTitle}</h2><p>{copy.landingFreeText}</p></div>
      </article>
      <article>
        <span className="landing-claim-mark"><ShieldCheck size={17} aria-hidden="true" /></span>
        <div><h2>{copy.landingPrivacyTitle}</h2><p>{copy.landingPrivacyText}</p></div>
      </article>
    </section>

    <section className="landing-features">
      <p className="landing-eyebrow"><Pentagon size={13} aria-hidden="true" />{copy.landingFeaturesEyebrow}</p>
      <div className="landing-grid">
        {features.map((feature) => <article key={feature.title}>
          <span>{feature.icon}</span>
          <h3>{feature.title}</h3>
          <p>{feature.text}</p>
        </article>)}
      </div>
    </section>

    <section className="landing-closing">
      <BrandLockup height={26} />
      <a className="landing-cta" href="/anotar">{copy.landingCta}</a>
      <p>{copy.landingCtaNote}</p>
    </section>

    <footer className="landing-foot">
      <span className="landing-free-badge"><Check size={12} aria-hidden="true" />{copy.landingBadgeFree}</span>
      <p>{copy.landingFooterNote}</p>
    </footer>
  </main>;
}
