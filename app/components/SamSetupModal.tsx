"use client";

import {
  AlertTriangle, Check, Cpu, Download, ExternalLink, Gauge, HardDrive,
  KeyRound, Laptop, Link2, Server, ShieldCheck, Sparkles, Terminal, X,
} from "lucide-react";
import { SAM_MODELS, getSamModel } from "../lib/sam-models";
import type { SamModelId } from "../lib/sam-models";

type ConnectionState = "idle" | "checking" | "loading" | "ready" | "error" | "offline";

type Props = {
  selectedModelId: SamModelId;
  loadedModelId: string | null;
  connectionState: ConnectionState;
  runtimeLabel: string;
  endpoint: string;
  onSelectModel: (modelId: SamModelId) => void;
  onEndpointChange: (endpoint: string) => void;
  onConnect: () => void;
  onClose: () => void;
};

const capabilityLabels = {
  imageSegmentation: "Imagem",
  videoSegmentation: "Vídeo",
  pointPrompts: "Pontos",
  negativePointPrompts: "Pontos negativos",
  boxPrompts: "Caixas",
  maskPrompts: "Máscara anterior",
  textPrompts: "Texto",
  exemplarPrompts: "Exemplares",
  automaticMaskGeneration: "Máscaras automáticas",
  multimaskCandidates: "Múltiplas alternativas",
  interactiveRefinement: "Refinamento",
  instanceSegmentation: "Instâncias",
  conceptSegmentation: "Conceitos",
  videoTracking: "Tracking",
  multiObjectTracking: "Multiobjeto",
  bidirectionalPropagation: "Propagação bidirecional",
} as const;

function statusLabel(state: ConnectionState, modelMatches: boolean) {
  if (state === "checking") return "Verificando o conector local…";
  if (state === "loading") return "Modelo carregando…";
  if (state === "error") return "O conector foi encontrado, mas o modelo falhou ao carregar";
  if (state === "ready" && modelMatches) return "Modelo selecionado pronto";
  if (state === "ready") return "Outro modelo está carregado; usar este vai trocá-lo";
  return "Conector não encontrado";
}

function benchmarkSummary(model: (typeof SAM_MODELS)[number]) {
  if (model.benchmark.kind === "sam2-video") {
    return {
      value: `${model.benchmark.fps} FPS de vídeo`,
      label: `${model.benchmark.hardware} · VOS`,
      details: `SA-V ${model.benchmark.saVJAndF} · MOSE ${model.benchmark.moseJAndF} · LVOS ${model.benchmark.lvosV2JAndF} J&F. ${model.benchmark.software}`,
    };
  }
  return {
    value: `${model.benchmark.latencyMs} ms`,
    label: model.benchmark.hardware,
    details: "Imagem com mais de 100 objetos, segundo o benchmark publicado pela Meta",
  };
}

export default function SamSetupModal({
  selectedModelId,
  loadedModelId,
  connectionState,
  runtimeLabel,
  endpoint,
  onSelectModel,
  onEndpointChange,
  onConnect,
  onClose,
}: Props) {
  const model = getSamModel(selectedModelId) ?? SAM_MODELS[0];
  const benchmark = benchmarkSummary(model);
  const modelMatches = connectionState === "ready" && loadedModelId === model.id;
  const pythonNotes = "notes" in model.requirements.python ? model.requirements.python.notes : null;
  const cudaTested = "tested" in model.requirements.cuda ? model.requirements.cuda.tested : null;
  const activeCapabilities = Object.entries(model.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([capability]) => capabilityLabels[capability as keyof typeof capabilityLabels]);
  const unixCommand = `bash visionlabel-sam-macos-linux.sh ${model.id}`;
  const windowsCommand = `visionlabel-sam-windows.bat ${model.id}`;
  const windowsPlatformLabel = "Windows · WSL2";
  const unixPlatformLabel = model.family === "sam3"
    ? "Linux · NVIDIA CUDA"
    : "Linux · macOS (CPU) · WSL2";

  return <div className="modal-backdrop sam-catalog-backdrop">
    <section className="sam-catalog-modal" role="dialog" aria-modal="true" aria-labelledby="sam-catalog-title">
      <header>
        <div><span><Sparkles size={21} /></span><div><h2 id="sam-catalog-title">Modelos Segment Anything</h2><p>Escolha o modelo conforme recursos, hardware e licença.</p></div></div>
        <button onClick={onClose} aria-label="Fechar"><X size={21} /></button>
      </header>

      <div className="sam-catalog-body">
        <aside className="sam-model-list" aria-label="Modelos disponíveis">
          {(["sam2", "sam3"] as const).map((family) => <section key={family}>
            <h3>{family === "sam2" ? "SAM 2.1 · recomendado" : "SAM 3 · conceitos"}</h3>
            {SAM_MODELS.filter((candidate) => candidate.family === family).map((candidate) => <button
              key={candidate.id}
              className={candidate.id === model.id ? "active" : ""}
              aria-pressed={candidate.id === model.id}
              onClick={() => onSelectModel(candidate.id)}
            >
              <span><b>{candidate.name}</b><small>{candidate.parameters.label} · {candidate.checkpoint.approximateSizeLabel}</small></span>
              <em>{candidate.recommended ? "Recomendado" : candidate.experimental ? "Experimental" : candidate.version}</em>
            </button>)}
          </section>)}
        </aside>

        <div className="sam-model-detail">
          <section className="sam-model-hero">
            <div><span className={`family ${model.family}`}>{model.family === "sam2" ? "SAM 2.1" : model.family.toUpperCase()}</span>{model.experimental && <span className="experimental">Experimental</span>}</div>
            <h3>{model.name}</h3>
            <p>{model.description}</p>
            <div className="sam-model-facts">
              <span><HardDrive size={14} /><b>{model.checkpoint.approximateSizeLabel}</b><small>checkpoint</small></span>
              <span><Cpu size={14} /><b>{model.parameters.label}</b><small>parâmetros</small></span>
              <span><ShieldCheck size={14} /><b>{model.license.name}</b><small>licença</small></span>
            </div>
          </section>

          <section className="sam-capabilities">
            <h4>Capacidades do modelo upstream</h4>
            <div>{activeCapabilities.map((capability) => <span key={capability}><Check size={11} />{capability}</span>)}</div>
            <p><b>Integrado agora:</b> pontos positivos/negativos e caixas em todos os modelos; texto e múltiplas instâncias no SAM 3. Vídeo, máscara anterior, geração automática e exemplares combinados ainda não fazem parte deste editor.</p>
            {model.capabilities.videoSegmentation && <p>O modelo suporta vídeo, mas esta versão do editor integra apenas imagens. Timeline e tracking entrarão em uma etapa própria.</p>}
          </section>

          {model.futureCapabilities.map((future) => <section className="sam-future-note" key={future.name}>
            <Sparkles size={16} />
            <div><b>{future.name} · disponível upstream</b><p>{future.description}</p><small>Ainda não integrado nem instalável por este editor. Referência oficial: {future.benchmark.speedupAt128Objects} em {future.benchmark.hardware}; o ganho depende da quantidade de objetos.</small></div>
          </section>)}

          <section className="sam-requirements-grid">
            <article><span><Terminal size={15} /></span><div><b>Stack</b><p>Python {model.requirements.python.minimum}+ · PyTorch {model.requirements.pytorch.minimum}+{model.requirements.pytorch.torchvisionMinimum ? ` · Torchvision ${model.requirements.pytorch.torchvisionMinimum}+` : ""}.{pythonNotes ? ` ${pythonNotes}` : ""}</p></div></article>
            <article><span><Cpu size={15} /></span><div><b>Processamento</b><p>{model.requirements.compute.notes}</p></div></article>
            <article className={model.requirements.cuda.required ? "critical" : ""}><span><Server size={15} /></span><div><b>CUDA</b><p>{model.requirements.cuda.required ? `Obrigatório: CUDA ${model.requirements.cuda.minimum}+` : "Opcional; GPU CUDA recomendada"}{cudaTested ? ` · teste oficial: ${cudaTested}` : ""}</p></div></article>
            <article><span><Laptop size={15} /></span><div><b>Sistema</b><p>{model.requirements.operatingSystem.official}. {model.requirements.operatingSystem.notes}</p></div></article>
            <article><span><HardDrive size={15} /></span><div><b>RAM e VRAM</b><p>{model.requirements.vram.notes} {model.requirements.ram.notes}</p></div></article>
            <article className={model.requirements.access.type === "gated" ? "critical" : ""}><span><KeyRound size={15} /></span><div><b>Acesso</b><p>{model.requirements.access.notes}</p></div></article>
          </section>

          <section className="sam-benchmark">
            <div><Gauge size={18} /><span><b>{benchmark.value}</b><small>{benchmark.label}</small></span></div>
            <p>{benchmark.details}</p>
            <em>Resultado de referência, não previsão para sua GPU. {model.benchmark.notes[0]}</em>
          </section>

          {model.experimental && <section className="sam-license-warning"><AlertTriangle size={17} /><div><b>Licença e acesso diferentes</b><p>{model.license.notes}</p></div></section>}

          <section className="sam-install-panel">
            <div><b>Instalar o modelo selecionado</b><p>O instalador cria um ambiente separado por família e baixa apenas o checkpoint escolhido.</p></div>
            <div className="sam-install-actions">
              <a className="primary" href="/visionlabel-sam-macos-linux.sh" download><Download size={15} /><span><strong>{unixPlatformLabel}</strong><small>{unixCommand}</small></span></a>
              <a className={model.family === "sam3" ? "limited" : ""} href="/visionlabel-sam-windows.bat" download><Download size={15} /><span><strong>{windowsPlatformLabel}</strong><small>{windowsCommand}</small></span></a>
            </div>
            <code>{unixCommand}</code>
            <div className="sam-launch-actions"><span>Já instalado?</span><a href="/visionlabel-sam-start-macos-linux.sh" download>Baixar iniciador {unixPlatformLabel}</a><a href="/visionlabel-sam-start-windows.bat" download>Baixar iniciador {windowsPlatformLabel}</a></div>
            <p className="sam-platform-note"><b>Linux:</b> {model.platformSupport.linux.notes} <b>Windows:</b> {model.platformSupport.windows.notes} <b>macOS:</b> {model.platformSupport.macos.notes}</p>
          </section>

          <section className={`sam-runtime-status ${connectionState} ${connectionState === "ready" && !modelMatches ? "mismatch" : ""}`}>
            <span />
            <div><b>{statusLabel(connectionState, modelMatches)}</b>{runtimeLabel && <small>{runtimeLabel}</small>}{connectionState === "error" && <small>Revise o checkpoint, a versão do CUDA e as dependências; depois reinicie o conector.</small>}{connectionState === "ready" && !modelMatches && <small>Clique em “Carregar este modelo” para trocar o conector para <code>{model.id}</code>, sem reiniciar nada à mão.</small>}</div>
          </section>

          <details className="sam-advanced">
            <summary>Configuração avançada</summary>
            <label>Endereço local<input type="url" value={endpoint} placeholder="http://127.0.0.1:7860/predict" onChange={(event) => onEndpointChange(event.target.value)} /></label>
            <div className="sam-official-links"><a href={model.officialSources.repository} target="_blank" rel="noreferrer"><ExternalLink size={12} />Repositório oficial</a><a href={model.officialSources.checkpoint} target="_blank" rel="noreferrer"><ExternalLink size={12} />Checkpoint oficial</a></div>
          </details>

          <section className="sam-privacy"><ShieldCheck size={16} /><div><b>Inferência local</b><p>Imagens e prompts ficam no computador. No SAM 3, a autenticação Hugging Face é usada somente pelo instalador local para obter o checkpoint.</p></div></section>
        </div>
      </div>

      <footer>
        <button onClick={onClose}>Fechar</button>
        <button className="connect" disabled={connectionState === "checking" || connectionState === "loading"} onClick={onConnect}>
          {connectionState === "checking" || connectionState === "loading" ? <Gauge className="spin" size={15} /> : <Link2 size={15} />}
          {connectionState === "loading"
            ? "Carregando modelo…"
            : modelMatches
              ? "Usar este modelo"
              : connectionState === "ready"
                ? "Carregar este modelo"
                : "Verificar e usar"}
        </button>
      </footer>
    </section>
  </div>;
}
