// ═══════════════════════════════════════════════════
// SCALA WhatsApp Bot — Complete Platform Knowledge Base
// SARA uses this to help users USE the platform, not just buy it.
// ═══════════════════════════════════════════════════

// ─── Core Modules ───
export interface ScalaModule {
    name: string;
    slug: string;
    url: string;
    description: string;
    description_en?: string;
    description_es?: string;
    description_pt?: string;
    features: string[];
    features_en?: string[];
    howToUse: string;
    howToUse_en?: string;
    howToUse_es?: string;
    howToUse_pt?: string;
    commonQuestions: Array<{ q: string; a: string; q_en?: string; a_en?: string }>;
    keywords: string[];
}

export const SCALA_MODULES: Record<string, ScalaModule> = {
    strategy: {
        name: 'Strategy',
        slug: 'strategy',
        url: 'https://app.get-scala.com/strategy',
        description: 'Il modulo strategico di SCALA. Contiene gli strumenti per analizzare e definire il modello di business, identificare punti di forza e debolezza, e pianificare la crescita.',
        description_en: 'The strategic module of SCALA. Contains tools to analyse and define your business model, identify strengths and weaknesses, and plan growth.',
        description_es: 'El modulo estrategico de SCALA. Contiene herramientas para analizar y definir tu modelo de negocio, identificar fortalezas y debilidades, y planificar el crecimiento.',
        description_pt: 'O modulo estrategico do SCALA. Contem ferramentas para analisar e definir seu modelo de negocio, identificar forcas e fraquezas, e planejar o crescimento.',
        features: [
            'Business Model Canvas (BMC) — i 9 blocchi: segmenti clienti, proposta di valore, canali, relazioni con clienti, flussi di ricavi, risorse chiave, attività chiave, partnership chiave, struttura dei costi',
            'Analisi SWOT — Strengths, Weaknesses, Opportunities, Threats con AI suggestions',
            'Pareto 80/20 — identifica il 20% di attività che genera l\'80% dei risultati',
            'Porter\'s 5 Forces — analisi forze competitive del settore',
            'Decision Matrix — confronta opzioni con criteri pesati per prendere decisioni data-driven',
            'Matrice Ansoff — strategie di crescita (penetrazione mercato, sviluppo prodotto, sviluppo mercato, diversificazione)',
            'Matrice BCG — classificazione prodotti/servizi (star, cash cow, question mark, dog)',
            'Blue Ocean Strategy — identificare spazi di mercato non contesi',
        ],
        howToUse: 'Vai su Strategy dal menu laterale. Scegli lo strumento (es. BMC). Compila i campi guidato dall\'AI — puoi anche dettare a voce. L\'AI suggerisce automaticamente contenuti basati sul tuo settore. Puoi esportare in PDF o condividere con il team.',
        howToUse_en: 'Go to Strategy from the sidebar. Choose a tool (e.g. BMC). Fill in the fields guided by AI — you can also dictate by voice. The AI automatically suggests content based on your industry. You can export to PDF or share with the team.',
        howToUse_es: 'Ve a Strategy desde el menu lateral. Elige una herramienta (ej. BMC). Rellena los campos guiado por la IA — tambien puedes dictar por voz. La IA sugiere automaticamente contenido basado en tu sector. Puedes exportar a PDF o compartir con el equipo.',
        howToUse_pt: 'Va a Strategy pelo menu lateral. Escolha uma ferramenta (ex. BMC). Preencha os campos guiado pela IA — voce tambem pode ditar por voz. A IA sugere automaticamente conteudo baseado no seu setor. Voce pode exportar para PDF ou compartilhar com a equipe.',
        commonQuestions: [
            { q: 'Come creo un BMC?', a: 'Vai su Strategy > Business Model Canvas. Trovi i 9 blocchi pronti da compilare. Inizia da "Segmenti Clienti" — chi sono i tuoi clienti ideali? L\'AI ti suggerisce contenuti basati sul tuo settore. Puoi compilare tutto in 15 minuti.' },
            { q: 'Come faccio una SWOT?', a: 'Vai su Strategy > SWOT Analysis. Inserisci i tuoi punti di forza e debolezza, poi le opportunità e minacce esterne. L\'AI analizza il tuo settore e suggerisce elementi che potresti non aver considerato.' },
            { q: 'A cosa serve il Pareto?', a: 'Il Pareto 80/20 ti aiuta a capire quali attività generano più valore. Inserisci le tue attività principali con i risultati e l\'AI identifica il 20% su cui concentrarti per massimizzare l\'impatto.' },
            { q: 'Come uso Porter?', a: 'Le 5 Forze di Porter analizzano il tuo settore: potere dei fornitori, potere dei clienti, minaccia nuovi entranti, minaccia prodotti sostitutivi, rivalità competitiva. L\'AI ti guida con domande specifiche per il tuo settore.' },
        ],
        keywords: ['strategia', 'strategy', 'bmc', 'canvas', 'business model', 'swot', 'pareto', 'porter', 'decision matrix', 'matrice', 'ansoff', 'bcg', 'blue ocean', 'crescita strategica', 'modello di business', 'pianificazione', 'forze competitive'],
    },

    confirmation: {
        name: 'Confirmation Center',
        slug: 'pilot',
        url: 'https://app.get-scala.com/pilot',
        description: 'Il centro di validazione di SCALA. Permette di testare idee, lanciare pilot e validare MVP prima di investire risorse significative.',
        description_es: 'El centro de validacion de SCALA. Permite probar ideas, lanzar pilotos y validar MVPs antes de invertir recursos significativos.',
        description_pt: 'O centro de validacao do SCALA. Permite testar ideias, lancar pilotos e validar MVPs antes de investir recursos significativos.',
        features: [
            'Pilot Testing — lancia test controllati con KPI misurabili in 90 giorni',
            'MVP Validation — definisci il minimo prodotto vitale e i criteri di successo',
            'A/B Test Framework — confronta due approcci e misura i risultati',
            'Experiment Tracker — traccia tutti gli esperimenti con risultati e learnings',
            'Go/No-Go Dashboard — dashboard decisionale basata sui dati del pilot',
        ],
        howToUse: 'Vai su Confirmation Center dal menu. Crea un nuovo Pilot: dai un nome, definisci l\'ipotesi, i KPI di successo (es. "30 clienti in 14 giorni"), la durata e il budget. L\'AI monitora i progressi e ti avvisa se sei on-track o devi pivotare.',
        howToUse_es: 'Ve a Confirmation Center desde el menu. Crea un nuevo Pilot: dale un nombre, define la hipotesis, los KPIs de exito (ej. "30 clientes en 14 dias"), la duracion y el presupuesto. La IA monitorea el progreso y te avisa si vas bien o debes pivotar.',
        howToUse_pt: 'Va ao Confirmation Center pelo menu. Crie um novo Pilot: de um nome, defina a hipotese, os KPIs de sucesso (ex. "30 clientes em 14 dias"), a duracao e o orcamento. A IA monitora o progresso e avisa se voce esta no caminho certo ou precisa pivotar.',
        commonQuestions: [
            { q: 'Come lancio un pilot?', a: 'Vai su Confirmation Center > Nuovo Pilot. Definisci: 1) Ipotesi da testare (es. "I clienti pagano €X per Y"), 2) KPI di successo (es. 30 clienti, 85% soddisfazione), 3) Durata (30-90 giorni), 4) Budget massimo. L\'AI traccia i progressi e ti dice se continuare o pivotare.' },
            { q: 'Come valido un\'idea?', a: 'Usa il framework MVP: definisci il problema, la soluzione minima, il target, e i criteri di successo. Il sistema ti guida step-by-step e ti aiuta a non over-investire prima della validazione.' },
            { q: 'Cos\'è il Go/No-Go?', a: 'È una dashboard che aggrega i dati del tuo pilot e ti dà un verdetto chiaro: i KPI sono raggiunti? Il pilot è sostenibile? Devi pivotare? Ti aiuta a prendere la decisione basandoti sui dati, non sull\'istinto.' },
        ],
        keywords: ['pilot', 'validazione', 'mvp', 'test', 'esperimento', 'ab test', 'go no go', 'ipotesi', 'validare', 'lanciare', 'confirmation', 'prototipo', '90 giorni'],
    },

    activation: {
        name: 'Activation',
        slug: 'okr',
        url: 'https://app.get-scala.com/okr',
        description: 'Il modulo di attivazione operativa. Gestisci obiettivi, team e organigramma per passare dalla strategia all\'esecuzione.',
        description_es: 'El modulo de activacion operativa. Gestiona objetivos, equipo y organigrama para pasar de la estrategia a la ejecucion.',
        description_pt: 'O modulo de ativacao operacional. Gerencie objetivos, equipe e organograma para passar da estrategia a execucao.',
        features: [
            'OKR (Objectives and Key Results) — definisci obiettivi e risultati chiave misurabili',
            'North Star Metric — identifica la metrica unica che guida la crescita',
            'Org Chart AI — organigramma interattivo con ruoli e responsabilità',
            'Team Management — assegnazione task, monitoraggio performance, feedback',
            'Alignment Dashboard — verifica che tutti i team siano allineati sugli obiettivi',
        ],
        howToUse: 'Vai su Activation. Inizia definendo la tua North Star Metric (la metrica n.1 del tuo business). Poi crea gli OKR trimestrali: un Objective qualitativo (es. "Diventare il leader locale") e 3-5 Key Results quantitativi (es. "Acquisire 50 nuovi clienti"). Assegna i KR ai team member.',
        howToUse_es: 'Ve a Activation. Empieza definiendo tu North Star Metric (la metrica n.1 de tu negocio). Luego crea OKRs trimestrales: un Objective cualitativo (ej. "Ser lider local") y 3-5 Key Results cuantitativos (ej. "Adquirir 50 nuevos clientes"). Asigna los KR a los miembros del equipo.',
        howToUse_pt: 'Va a Activation. Comece definindo sua North Star Metric (a metrica n.1 do seu negocio). Depois crie OKRs trimestrais: um Objective qualitativo (ex. "Ser lider local") e 3-5 Key Results quantitativos (ex. "Adquirir 50 novos clientes"). Atribua os KR aos membros da equipe.',
        commonQuestions: [
            { q: 'Come imposto gli OKR?', a: 'Vai su Activation > OKR. Crea un Objective (qualitativo, ispirazionale, es. "Dominare il mercato locale"). Aggiungi 3-5 Key Results misurabili (es. "Aumentare clienti del 30%", "NPS > 8.5"). Assegna ogni KR a un responsabile. L\'AI monitora i progressi e ti avvisa se sei off-track.' },
            { q: 'Cos\'è la North Star?', a: 'È la metrica unica che meglio rappresenta il valore che dai ai clienti. Per un ristorante potrebbe essere "clienti che tornano entro 14 giorni", per un\'agenzia "campagne con ROAS > 3x". Ti aiuta a focalizzare tutto il team su ciò che conta davvero.' },
            { q: 'Come creo l\'organigramma?', a: 'Vai su Activation > Org Chart. Aggiungi i ruoli partendo dal vertice. Per ogni ruolo puoi definire: responsabilità, KPI, a chi riporta. L\'AI suggerisce i ruoli mancanti basandosi sul tuo settore e dimensione.' },
        ],
        keywords: ['okr', 'obiettivi', 'key results', 'north star', 'organigramma', 'team', 'activation', 'attivazione', 'allineamento', 'performance', 'ruoli', 'responsabilità'],
    },

    leverage: {
        name: 'Leverage',
        slug: 'process',
        url: 'https://app.get-scala.com/process',
        description: 'Il modulo di leva operativa. Analizza, ottimizza e automatizza i processi aziendali per fare di più con meno.',
        description_es: 'El modulo de apalancamiento operativo. Analiza, optimiza y automatiza los procesos empresariales para hacer mas con menos.',
        description_pt: 'O modulo de alavancagem operacional. Analise, otimize e automatize os processos empresariais para fazer mais com menos.',
        features: [
            'Process Analyzer — mappa visivamente i processi aziendali, identifica colli di bottiglia',
            'Voice-to-SOP — detta a voce un processo e l\'AI crea la SOP (Standard Operating Procedure) in 30 secondi',
            'Automazioni — crea regole if/then per automatizzare attività ripetitive',
            'ROI Calculator — calcola il ritorno sull\'investimento di ogni ottimizzazione',
            'Tech Stack Analyzer — valuta gli strumenti attuali e suggerisce ottimizzazioni',
            'Efficiency Scorecard — punteggio di efficienza per ogni processo',
        ],
        howToUse: 'Vai su Leverage > Process Analyzer. Puoi: 1) Creare un processo manualmente (aggiungi step, responsabili, tempi), 2) Dettare a voce il processo (Voice-to-SOP — l\'AI lo struttura automaticamente), 3) Importare un processo esistente. L\'AI analizza colli di bottiglia e suggerisce ottimizzazioni.',
        howToUse_es: 'Ve a Leverage > Process Analyzer. Puedes: 1) Crear un proceso manualmente (agrega pasos, responsables, tiempos), 2) Dictar el proceso por voz (Voice-to-SOP — la IA lo estructura automaticamente), 3) Importar un proceso existente. La IA analiza cuellos de botella y sugiere optimizaciones.',
        howToUse_pt: 'Va a Leverage > Process Analyzer. Voce pode: 1) Criar um processo manualmente (adicione etapas, responsaveis, tempos), 2) Ditar o processo por voz (Voice-to-SOP — a IA estrutura automaticamente), 3) Importar um processo existente. A IA analisa gargalos e sugere otimizacoes.',
        commonQuestions: [
            { q: 'Come automatizzo un processo?', a: 'Vai su Leverage > Process Analyzer. Mappa il processo attuale (ogni step con tempo e responsabile). L\'AI identifica gli step automatizzabili e suggerisce automazioni. Per ogni automazione puoi vedere il risparmio di tempo e il ROI stimato.' },
            { q: 'Come creo una SOP?', a: 'Hai due opzioni: 1) Voice-to-SOP: detta a voce il processo (es. "Quando arriva un ordine, prima verifico il pagamento, poi preparo il prodotto...") e l\'AI crea la SOP strutturata in 30 secondi. 2) Manuale: aggiungi ogni step con descrizione, responsabile e tempo stimato.' },
            { q: 'Come calcolo il ROI?', a: 'Il ROI Calculator è integrato in ogni processo. Per ogni ottimizzazione proposta, vedi: tempo risparmiato, costo risparmiato, investimento necessario e payback period. Ti aiuta a prioritizzare le ottimizzazioni con il ROI più alto.' },
            { q: 'Inserisci una SOP nel process analyzer', a: 'Puoi farlo direttamente dalla piattaforma! Vai su Leverage > Process Analyzer > Nuova SOP. Puoi dettare a voce il processo oppure scriverlo. L\'AI lo struttura automaticamente con step, responsabili e tempi.' },
        ],
        keywords: ['processo', 'processi', 'sop', 'automazione', 'automatizzare', 'workflow', 'flusso', 'efficienza', 'ottimizzare', 'collo di bottiglia', 'roi', 'tech stack', 'leverage', 'leva', 'produzione', 'logistica', 'magazzino'],
    },

    acceleration: {
        name: 'Acceleration',
        slug: 'expansion',
        url: 'https://app.get-scala.com/expansion',
        description: 'Il modulo di accelerazione della crescita. Pianifica l\'espansione, traccia le metriche di crescita e scala il business.',
        description_es: 'El modulo de aceleracion del crecimiento. Planifica la expansion, rastrea las metricas de crecimiento y escala el negocio.',
        description_pt: 'O modulo de aceleracao do crescimento. Planeje a expansao, rastreie as metricas de crescimento e escale o negocio.',
        features: [
            'Roadmap Interattiva — pianifica milestones e obiettivi di crescita nel tempo',
            'Expansion Planning — analizza nuovi mercati, canali, prodotti da lanciare',
            'Growth Metrics Dashboard — metriche di crescita in tempo reale',
            'Academy & Growth Hacking — accesso a contenuti e strategie di crescita',
            'Scaling Playbook — guide passo-passo per scalare ogni area del business',
        ],
        howToUse: 'Vai su Acceleration. Usa la Roadmap per pianificare i prossimi 12 mesi: aggiungi milestones (es. "Lancio nuovo prodotto Q2"), timeline e KPI. L\'Expansion Planning ti aiuta ad analizzare opportunità di crescita. Le Growth Metrics tracciano l\'andamento.',
        howToUse_es: 'Ve a Acceleration. Usa la Roadmap para planificar los proximos 12 meses: agrega hitos (ej. "Lanzamiento nuevo producto Q2"), cronograma y KPIs. El Expansion Planning te ayuda a analizar oportunidades de crecimiento. Las Growth Metrics rastrean la evolucion.',
        howToUse_pt: 'Va a Acceleration. Use a Roadmap para planejar os proximos 12 meses: adicione marcos (ex. "Lancamento novo produto Q2"), cronograma e KPIs. O Expansion Planning ajuda a analisar oportunidades de crescimento. As Growth Metrics rastreiam a evolucao.',
        commonQuestions: [
            { q: 'Come creo una roadmap?', a: 'Vai su Acceleration > Roadmap. Aggiungi le milestones principali (es. "50 clienti entro Q1", "Lancio nuovo servizio Q2"). Per ogni milestone definisci: data target, KPI, responsabile. La timeline visiva ti mostra tutto il percorso di crescita.' },
            { q: 'Come pianifico l\'espansione?', a: 'Usa Expansion Planning per valutare nuove opportunità: nuovi mercati geografici, nuovi segmenti clienti, nuovi prodotti/servizi. L\'AI analizza il potenziale e i rischi di ogni opzione basandosi sui tuoi dati.' },
        ],
        keywords: ['accelerazione', 'crescita', 'expansion', 'roadmap', 'scalare', 'growth', 'espansione', 'milestones', 'obiettivi crescita', 'academy'],
    },

    crm: {
        name: 'CRM',
        slug: 'crm',
        url: 'https://app.get-scala.com/crm',
        description: 'Il CRM integrato di SCALA. Gestisci contatti, pipeline vendita, email automation e lead scoring tutto in un posto.',
        description_es: 'El CRM integrado de SCALA. Gestiona contactos, pipeline de ventas, automatizacion de email y lead scoring todo en un solo lugar.',
        description_pt: 'O CRM integrado do SCALA. Gerencie contatos, pipeline de vendas, automacao de email e lead scoring tudo em um so lugar.',
        features: [
            'Contatti — database centralizzato con campi personalizzabili, tag, note, storico interazioni',
            'Pipeline Vendita — stadi personalizzabili (Lead > Qualificato > Proposta > Negoziazione > Chiuso), drag & drop',
            'Lead Scoring AI — punteggio automatico basato su comportamento e profilo',
            'Email Automation — sequenze email automatiche per nurturing e follow-up',
            'Tag & Segmentazione — organizza contatti per settore, interesse, stato, fonte',
            'Attività & Task — assegna follow-up, call, meeting ai team members',
            'Revenue Forecast (Pro) — previsione fatturato basata sulla pipeline',
            'Quote Generator (Pro) — genera preventivi professionali',
            'WhatsApp/Telegram Integration (Pro) — comunicazione multi-canale',
        ],
        howToUse: 'Vai su CRM dal menu. Per aggiungere un contatto: clicca "+ Nuovo Contatto", inserisci nome, email, telefono, azienda. Assegna un tag per categorizzarlo. Per la pipeline: trascina i contatti tra gli stadi. Per le automazioni: vai su Automazioni e crea sequenze email.',
        howToUse_es: 'Ve a CRM desde el menu. Para agregar un contacto: haz clic en "+ Nuevo Contacto", ingresa nombre, email, telefono, empresa. Asigna un tag para categorizarlo. Para el pipeline: arrastra los contactos entre las etapas. Para automatizaciones: ve a Automatizaciones y crea secuencias de email.',
        howToUse_pt: 'Va ao CRM pelo menu. Para adicionar um contato: clique em "+ Novo Contato", insira nome, email, telefone, empresa. Atribua uma tag para categoriza-lo. Para o pipeline: arraste os contatos entre as etapas. Para automacoes: va a Automacoes e crie sequencias de email.',
        commonQuestions: [
            { q: 'Come aggiungo un contatto?', a: 'Vai su CRM > Contatti > "+ Nuovo Contatto". Compila: nome, cognome, email, telefono, azienda. Puoi aggiungere tag (es. "lead caldo", "settore legale") e note. Il contatto appare subito nella tua lista e puoi aggiungerlo alla pipeline.' },
            { q: 'Come funziona la pipeline?', a: 'La pipeline ha stadi personalizzabili (Lead, Qualificato, Proposta, Negoziazione, Chiuso Vinto/Perso). Trascina i contatti da uno stadio all\'altro. Per ogni deal vedi: valore stimato, probabilità di chiusura, prossimo step. L\'AI suggerisce azioni per far avanzare i deal.' },
            { q: 'Come imposto un\'automazione email?', a: 'Vai su CRM > Automazioni > Nuova Sequenza. Definisci: trigger (es. "nuovo lead aggiunto"), azioni (es. "invia email di benvenuto dopo 1 ora, follow-up dopo 3 giorni"). Puoi usare template o scrivere email personalizzate con variabili.' },
            { q: 'Come funziona il lead scoring?', a: 'Il Lead Scoring AI assegna un punteggio automatico a ogni contatto basandosi su: aperture email, click, visite al sito, interazioni, profilo aziendale. I lead con punteggio alto appaiono in cima alla lista per prioritizzare il follow-up.' },
        ],
        keywords: ['crm', 'contatti', 'contatto', 'pipeline', 'lead', 'email', 'automazione email', 'tag', 'segmentazione', 'vendite', 'prospect', 'funnel', 'deal', 'opportunità', 'preventivo', 'follow-up', 'lead scoring'],
    },

    balanceSheet: {
        name: 'Balance Sheet Analyzer',
        slug: 'balance-sheet',
        url: 'https://app.get-scala.com/balance-sheet',
        description: 'L\'analizzatore di bilancio AI di SCALA. Carica un bilancio in PDF o CSV e ottieni un\'analisi completa con KPI, benchmark e forecasting.',
        description_es: 'El analizador de balances IA de SCALA. Sube un balance en PDF o CSV y obtiene un analisis completo con KPIs, benchmarks y forecasting.',
        description_pt: 'O analisador de balancos IA do SCALA. Carregue um balanco em PDF ou CSV e obtenha uma analise completa com KPIs, benchmarks e forecasting.',
        features: [
            'Upload PDF/CSV — carica il bilancio in qualsiasi formato',
            'AI Analysis — analisi automatica con estrazione di 15+ KPI finanziari',
            'KPI Dashboard — ROE, ROI, ROA, EBITDA, margini, DSO, DPO, Current Ratio, Quick Ratio',
            'Benchmark Settore — confronto con medie del tuo settore',
            'Forecasting 12 Mesi — previsioni AI basate su trend storici',
            'Scenario Simulator — simula scenari what-if (es. "se aumento vendite del 20%")',
            'Report PDF — genera report professionali esportabili',
        ],
        howToUse: 'Vai su Balance Sheet Analyzer. Clicca "Carica Bilancio" e seleziona il PDF o CSV. L\'AI lo analizza in 30 secondi e mostra: KPI principali, confronto con settore, aree critiche, suggerimenti di miglioramento. Puoi poi usare il Scenario Simulator per simulare cambiamenti.',
        howToUse_es: 'Ve a Balance Sheet Analyzer. Haz clic en "Subir Balance" y selecciona el PDF o CSV. La IA lo analiza en 30 segundos y muestra: KPIs principales, comparacion con el sector, areas criticas, sugerencias de mejora. Puedes usar el Simulador de Escenarios para simular cambios.',
        howToUse_pt: 'Va ao Balance Sheet Analyzer. Clique em "Carregar Balanco" e selecione o PDF ou CSV. A IA analisa em 30 segundos e mostra: KPIs principais, comparacao com o setor, areas criticas, sugestoes de melhoria. Voce pode usar o Simulador de Cenarios para simular mudancas.',
        commonQuestions: [
            { q: 'Voglio analizzare il mio bilancio', a: 'Vai su Balance Sheet Analyzer e carica il PDF del bilancio (o CSV). L\'AI estrae automaticamente tutti i dati e ti mostra: ROE, ROI, margini, liquidità, indebitamento. Ti dice dove stai bene e dove migliorare, confrontando con le medie del tuo settore.' },
            { q: 'Che KPI estrae?', a: 'Estrae oltre 15 KPI: ROE, ROI, ROA, EBITDA, margine operativo, margine netto, Current Ratio, Quick Ratio, DSO (tempi incasso), DPO (tempi pagamento), Debt/Equity, indice di liquidità, cash flow operativo e altri specifici per il tuo settore.' },
            { q: 'Come funziona il forecasting?', a: 'Dopo aver caricato il bilancio, vai su Forecasting. L\'AI usa i trend storici per proiettare i prossimi 12 mesi: fatturato, costi, margini, cash flow. Puoi modificare le assunzioni (es. "crescita vendite 15%") e vedere come cambiano le proiezioni.' },
            { q: 'Analizza questo bilancio', a: 'Per analizzare il bilancio, vai su app.get-scala.com/balance-sheet e carica il file PDF o CSV. Se vuoi, puoi anche inviarmi il PDF qui su WhatsApp e ti do un\'analisi preliminare!' },
        ],
        keywords: ['bilancio', 'balance sheet', 'analisi bilancio', 'kpi', 'roe', 'roi', 'ebitda', 'margine', 'cash flow', 'liquidità', 'indebitamento', 'forecasting', 'previsioni', 'scenario', 'conto economico', 'stato patrimoniale', 'finanziario'],
    },

    aiAdvisor: {
        name: 'AI Advisor',
        slug: 'ai-advisor',
        url: 'https://app.get-scala.com/ai-advisor',
        description: 'L\'AI Advisor di SCALA fornisce suggerimenti contestuali in ogni modulo. Analizza i tuoi dati e propone azioni concrete per migliorare.',
        description_es: 'El AI Advisor de SCALA ofrece sugerencias contextuales en cada modulo. Analiza tus datos y propone acciones concretas para mejorar.',
        description_pt: 'O AI Advisor do SCALA fornece sugestoes contextuais em cada modulo. Analisa seus dados e propoe acoes concretas para melhorar.',
        features: [
            'Suggerimenti Contestuali — consigli personalizzati in base ai dati inseriti in ogni modulo',
            'Action Items — proposte di azione concrete con priorità',
            'Insights Cross-Module — collega dati tra moduli per insights più profondi',
        ],
        howToUse: 'L\'AI Advisor è integrato ovunque. Quando compili un BMC, una SWOT, o analizzi un processo, l\'AI Advisor appare automaticamente con suggerimenti. Puoi anche chiedere direttamente: "Analizza il mio business" e ricevi un report completo.',
        howToUse_es: 'El AI Advisor esta integrado en todas partes. Cuando completas un BMC, un SWOT, o analizas un proceso, el AI Advisor aparece automaticamente con sugerencias. Tambien puedes preguntar directamente: "Analiza mi negocio" y recibes un informe completo.',
        howToUse_pt: 'O AI Advisor esta integrado em todo lugar. Quando voce preenche um BMC, um SWOT, ou analisa um processo, o AI Advisor aparece automaticamente com sugestoes. Voce tambem pode perguntar diretamente: "Analise meu negocio" e recebe um relatorio completo.',
        commonQuestions: [
            { q: 'Come uso l\'AI Advisor?', a: 'L\'AI Advisor è automatico. Ogni volta che lavori in un modulo (Strategy, CRM, Process...), l\'AI analizza i tuoi dati e mostra suggerimenti nel pannello laterale. Puoi anche fare domande dirette all\'AI Advisor per ricevere consigli personalizzati.' },
        ],
        keywords: ['ai advisor', 'consigli', 'suggerimenti', 'advisor', 'intelligenza artificiale', 'ai'],
    },

    aiCoach: {
        name: 'AI Coach',
        slug: 'ai-coach',
        url: 'https://app.get-scala.com/ai-coach',
        description: 'Il Business Coach AI di SCALA. Conversazioni di coaching personalizzate per aiutarti a prendere decisioni strategiche e superare sfide.',
        description_es: 'El Business Coach IA de SCALA. Conversaciones de coaching personalizadas para ayudarte a tomar decisiones estrategicas y superar desafios.',
        description_pt: 'O Business Coach IA do SCALA. Conversas de coaching personalizadas para ajuda-lo a tomar decisoes estrategicas e superar desafios.',
        features: [
            'Coaching Conversazionale — dialogo strutturato per esplorare sfide e opportunità',
            'Framework Decisionali — guida attraverso framework per prendere decisioni migliori',
            'Goal Setting — aiuta a definire e monitorare obiettivi personali e di business',
        ],
        howToUse: 'Vai su AI Coach. Inizia una sessione di coaching descrivendo la tua sfida o obiettivo. L\'AI ti guida con domande potenti e framework decisionali. Puoi riprendere sessioni precedenti per monitorare i progressi.',
        howToUse_es: 'Ve a AI Coach. Inicia una sesion de coaching describiendo tu desafio u objetivo. La IA te guia con preguntas poderosas y frameworks de decision. Puedes retomar sesiones anteriores para monitorear los progresos.',
        howToUse_pt: 'Va ao AI Coach. Inicie uma sessao de coaching descrevendo seu desafio ou objetivo. A IA guia voce com perguntas poderosas e frameworks de decisao. Voce pode retomar sessoes anteriores para monitorar os progressos.',
        commonQuestions: [
            { q: 'Come funziona il coach?', a: 'L\'AI Coach è come avere un business coach personale disponibile 24/7. Descrivi la tua sfida ("Non so come scalare", "Ho un problema col team") e l\'AI ti guida con domande e framework. Non ti dà risposte pronte ma ti aiuta a trovarle.' },
        ],
        keywords: ['coach', 'coaching', 'mentore', 'decisione', 'sfida', 'obiettivo personale', 'crescita personale'],
    },

    knowledgeBase: {
        name: 'Knowledge Base RAG',
        slug: 'knowledge-base',
        url: 'https://app.get-scala.com/knowledge-base',
        description: 'La Knowledge Base di SCALA. Carica i tuoi documenti aziendali e l\'AI li usa per personalizzare tutti i suggerimenti e le risposte.',
        description_es: 'La Knowledge Base de SCALA. Sube tus documentos empresariales y la IA los usa para personalizar todas las sugerencias y respuestas.',
        description_pt: 'A Knowledge Base do SCALA. Carregue seus documentos empresariais e a IA os usa para personalizar todas as sugestoes e respostas.',
        features: [
            'Upload Documenti — PDF, Word, Excel, presentazioni, testo',
            'RAG (Retrieval Augmented Generation) — l\'AI cerca nei tuoi documenti per dare risposte personalizzate',
            'AI Memory — l\'AI ricorda il contesto della tua azienda',
            'Ricerca Semantica — cerca per concetti, non solo parole chiave',
        ],
        howToUse: 'Vai su Knowledge Base. Clicca "Carica Documento" e seleziona i file (PDF, Word, Excel). L\'AI li indicizza automaticamente. Da quel momento, ogni volta che usi l\'AI Advisor, il Coach o qualsiasi modulo, l\'AI ha accesso ai tuoi documenti per dare risposte più precise e contestualizzate.',
        howToUse_es: 'Ve a Knowledge Base. Haz clic en "Subir Documento" y selecciona los archivos (PDF, Word, Excel). La IA los indexa automaticamente. A partir de ese momento, cada vez que uses el AI Advisor, el Coach o cualquier modulo, la IA accede a tus documentos para dar respuestas mas precisas y contextualizadas.',
        howToUse_pt: 'Va a Knowledge Base. Clique em "Carregar Documento" e selecione os arquivos (PDF, Word, Excel). A IA indexa automaticamente. A partir desse momento, toda vez que voce usar o AI Advisor, o Coach ou qualquer modulo, a IA acessa seus documentos para dar respostas mais precisas e contextualizadas.',
        commonQuestions: [
            { q: 'Come carico documenti?', a: 'Vai su Knowledge Base > "Carica Documento". Puoi caricare PDF, Word, Excel, presentazioni. L\'AI li indicizza in pochi secondi. Da quel momento, tutti i moduli AI usano i tuoi documenti come contesto per risposte più personalizzate.' },
            { q: 'A cosa serve la Knowledge Base?', a: 'Più documenti carichi, più l\'AI diventa "esperta" del tuo business. Se carichi il business plan, i bilanci, le procedure interne, l\'AI può dare consigli basati sulla TUA situazione specifica, non generici.' },
        ],
        keywords: ['knowledge base', 'documenti', 'upload', 'carica', 'rag', 'memoria', 'contesto', 'personalizzare'],
    },
};

// ─── Vertical Knowledge ───
export interface ScalaVertical {
    name: string;
    slug: string;
    url: string;
    targetSector: string;
    targetSector_en?: string;
    targetSector_es?: string;
    targetSector_pt?: string;
    features: string[];
    features_en?: string[];
    howToUse: string;
    howToUse_en?: string;
    howToUse_es?: string;
    howToUse_pt?: string;
    keywords: string[];
}

export const SCALA_VERTICALS: Record<string, ScalaVertical> = {
    praxisos: {
        name: 'PraxisOS',
        slug: 'praxisos',
        url: 'https://app.get-scala.com/praxisos',
        targetSector: 'Studi legali, commercialisti, consulenti del lavoro, CAF',
        targetSector_es: 'Bufetes de abogados, contadores, consultores laborales',
        targetSector_pt: 'Escritorios de advocacia, contadores, consultores trabalhistas',
        features: [
            'Agenda — calendario condiviso multi-risorsa con prenotazione slot, reminder automatici',
            'Clienti — anagrafica completa con storico pratiche, documenti, comunicazioni',
            'Pratiche/Fascicoli — gestione fascicoli con stati, scadenze, documenti collegati, timeline',
            'Scadenze — scadenzario intelligente con alert automatici (fiscali, processuali, contrattuali)',
            'Documenti — gestione documentale con firma digitale, PEC, archiviazione automatica',
            'Fatturazione — ciclo attivo/passivo, parcellazione, proforma, invio SDI',
            'Timesheet — tracciamento ore per pratica, per professionista, per cliente',
        ],
        howToUse: 'PraxisOS è il gestionale verticale per studi professionali. Dal menu scegli la sezione (Agenda, Clienti, Pratiche...). Per ogni pratica puoi: assegnare un responsabile, aggiungere documenti, impostare scadenze con alert, tracciare le ore lavorate e generare la parcella automaticamente.',
        howToUse_es: 'PraxisOS es el gestor vertical para estudios profesionales. Desde el menu elige la seccion (Agenda, Clientes, Expedientes...). Para cada expediente puedes: asignar un responsable, agregar documentos, configurar vencimientos con alertas, rastrear horas trabajadas y generar la factura automaticamente.',
        howToUse_pt: 'PraxisOS e o gestor vertical para escritorios profissionais. No menu escolha a secao (Agenda, Clientes, Processos...). Para cada processo voce pode: atribuir um responsavel, adicionar documentos, configurar prazos com alertas, rastrear horas trabalhadas e gerar a fatura automaticamente.',
        keywords: ['praxisos', 'studio legale', 'commercialista', 'pratiche', 'fascicoli', 'scadenze', 'parcella', 'agenda studio', 'clienti studio'],
    },

    agencyos: {
        name: 'AgencyOS',
        slug: 'agencyos',
        url: 'https://app.get-scala.com/agencyos',
        targetSector: 'Agenzie di comunicazione, marketing, web agency, freelance creativi',
        targetSector_es: 'Agencias de comunicacion, marketing, web agency, freelance creativos',
        targetSector_pt: 'Agencias de comunicacao, marketing, web agency, freelancers criativos',
        features: [
            'Time Tracking — traccia ore per progetto, cliente, attività; timer integrato',
            'Social Calendar — piano editoriale multi-canale con preview, scheduling, approvazione',
            'Report Integrati — GA4 + Meta Ads + Google Ads in un\'unica dashboard',
            'Campagne — gestione campagne adv con budget, target, KPI, risultati',
            'Commesse — gestione progetti con timeline, deliverable, milestone, budget',
            'Brief Generator — crea brief strutturati per clienti e team',
            'Gestione Freelance — assegnazione task, tracking pagamenti, contratti',
        ],
        howToUse: 'AgencyOS centralizza tutto il lavoro dell\'agenzia. Per ogni cliente crei un progetto con commesse, timeline e budget. Il Social Calendar ti permette di pianificare i contenuti multi-canale. I Report aggregano dati da GA4 e piattaforme adv in una dashboard unificata.',
        howToUse_es: 'AgencyOS centraliza todo el trabajo de la agencia. Para cada cliente creas un proyecto con encargos, cronograma y presupuesto. El Social Calendar permite planificar contenidos multicanal. Los Reports agregan datos de GA4 y plataformas de publicidad en un dashboard unificado.',
        howToUse_pt: 'AgencyOS centraliza todo o trabalho da agencia. Para cada cliente voce cria um projeto com encomendas, cronograma e orcamento. O Social Calendar permite planejar conteudos multicanal. Os Reports agregam dados do GA4 e plataformas de publicidade em um dashboard unificado.',
        keywords: ['agencyos', 'agenzia', 'time tracking', 'social calendar', 'campagne', 'report', 'commesse', 'brief', 'freelance'],
    },

    dineos: {
        name: 'DineOS',
        slug: 'dineos',
        url: 'https://app.get-scala.com/dineos',
        targetSector: 'Ristoranti, pizzerie, bar, catering, dark kitchen',
        targetSector_es: 'Restaurantes, pizzerias, bares, catering, dark kitchen',
        targetSector_pt: 'Restaurantes, pizzarias, bares, catering, dark kitchen',
        features: [
            'Menu Engineering — gestione menu con analisi marginalità (matrice BCG), food cost per piatto',
            'Prenotazioni — sistema prenotazione con conferma automatica, waitlist, gestione no-show',
            'Recensioni — aggregatore recensioni Google/TripAdvisor/TheFork con risposte AI',
            'Inventario — gestione magazzino ingredienti con alert scorte minime, ordini fornitori',
            'Turni — gestione turni staff con disponibilità, permessi, costi orari',
            'QR Code Menu — menu digitale con QR, aggiornabile in tempo reale, multi-lingua',
            'Food Cost Calculator — calcolo costo piatto con ingredienti, porzioni, margine',
            'Delivery Integration — gestione ordini delivery multi-piattaforma',
        ],
        howToUse: 'DineOS gestisce tutto il ristorante. Menu: aggiungi piatti con ingredienti e costi, l\'AI calcola il food cost e suggerisce il prezzo. Prenotazioni: i clienti prenotano online, il sistema gestisce i tavoli. Inventario: traccia le scorte e ricevi alert quando un ingrediente sta per finire.',
        howToUse_es: 'DineOS gestiona todo el restaurante. Menu: agrega platos con ingredientes y costes, la IA calcula el food cost y sugiere el precio. Reservas: los clientes reservan online, el sistema gestiona las mesas. Inventario: rastrea existencias y recibe alertas cuando un ingrediente esta por acabarse.',
        howToUse_pt: 'DineOS gerencia todo o restaurante. Cardapio: adicione pratos com ingredientes e custos, a IA calcula o food cost e sugere o preco. Reservas: os clientes reservam online, o sistema gerencia as mesas. Inventario: rastreie estoques e receba alertas quando um ingrediente esta acabando.',
        keywords: ['dineos', 'ristorante', 'menu', 'prenotazioni', 'recensioni', 'inventario', 'turni', 'qr code', 'food cost', 'delivery'],
    },

    dermalyos: {
        name: 'DermalyOS',
        slug: 'dermalyos',
        url: 'https://app.get-scala.com/dermalyos',
        targetSector: 'Studi dermatologici, medicina estetica, cliniche',
        targetSector_es: 'Clinicas dermatologicas, medicina estetica, clinicas',
        targetSector_pt: 'Clinicas dermatologicas, medicina estetica, clinicas',
        features: [
            'Pazienti — cartella clinica digitale con anamnesi, trattamenti, foto, consensi',
            'Appuntamenti — agenda multi-risorsa (sala, medico, dispositivo) con reminder SMS/WhatsApp',
            'Trattamenti — catalogo trattamenti con protocolli, durata, prezzo, follow-up programmato',
            'Before/After — gallery foto prima/dopo con consenso paziente, visibile in portfolio',
            'LMS (Learning) — formazione continua per il team con video, quiz, certificati',
            'Consenso Informato — template consensi digitali con firma elettronica',
            'Follow-up Automatico — promemoria post-trattamento personalizzati',
        ],
        howToUse: 'DermalyOS è il gestionale per lo studio medico-estetico. Per ogni paziente hai una cartella completa con anamnesi, foto e storico trattamenti. L\'agenda gestisce più risorse (sale, dispositivi). Dopo ogni trattamento il sistema schedula automaticamente i follow-up.',
        howToUse_es: 'DermalyOS es el gestor para clinicas de medicina estetica. Para cada paciente tienes una ficha completa con anamnesis, fotos e historial de tratamientos. La agenda gestiona multiples recursos (salas, dispositivos). Despues de cada tratamiento el sistema programa automaticamente los seguimientos.',
        howToUse_pt: 'DermalyOS e o gestor para clinicas de medicina estetica. Para cada paciente voce tem uma ficha completa com anamnese, fotos e historico de tratamentos. A agenda gerencia multiplos recursos (salas, dispositivos). Apos cada tratamento o sistema agenda automaticamente os acompanhamentos.',
        keywords: ['dermalyos', 'dermatologia', 'pazienti', 'appuntamenti', 'trattamenti', 'before after', 'consenso', 'cartella clinica', 'follow-up paziente'],
    },

    propertyos: {
        name: 'PropertyOS',
        slug: 'propertyos',
        url: 'https://app.get-scala.com/propertyos',
        targetSector: 'Agenzie immobiliari, property manager, costruttori',
        targetSector_es: 'Agencias inmobiliarias, property managers, constructores',
        targetSector_pt: 'Imobiliarias, property managers, construtores',
        features: [
            'Immobili — database immobili con foto, planimetrie, documenti, classe energetica',
            'Valutazioni AI — stima valore immobile basata su comparativi e dati di mercato',
            'Open House — organizza e traccia visite con calendar condiviso e feedback',
            'Mappa Interattiva — visualizza immobili su mappa con filtri (zona, prezzo, tipologia)',
            'Matching AI — abbina automaticamente acquirenti e immobili in base ai criteri',
            'Pubblicazione Multi-Portale — pubblica su Immobiliare.it, Idealista, Subito in un click',
            'Gestione Mandati — traccia mandati esclusivi/non esclusivi con scadenze',
        ],
        howToUse: 'PropertyOS centralizza tutto l\'immobiliare. Aggiungi un immobile con foto, dati e documenti. L\'AI stima il valore di mercato. Il matching automatico suggerisce gli acquirenti più adatti. Puoi pubblicare su tutti i portali con un click e gestire le visite dal calendario.',
        howToUse_es: 'PropertyOS centraliza todo lo inmobiliario. Agrega un inmueble con fotos, datos y documentos. La IA estima el valor de mercado. El matching automatico sugiere los compradores mas adecuados. Puedes publicar en todos los portales con un clic y gestionar las visitas desde el calendario.',
        howToUse_pt: 'PropertyOS centraliza todo o imobiliario. Adicione um imovel com fotos, dados e documentos. A IA estima o valor de mercado. O matching automatico sugere os compradores mais adequados. Voce pode publicar em todos os portais com um clique e gerenciar as visitas pelo calendario.',
        keywords: ['propertyos', 'immobili', 'valutazione', 'open house', 'mappa', 'matching', 'portali', 'mandato', 'agenzia immobiliare'],
    },

    motoros: {
        name: 'MotorOS',
        slug: 'motoros',
        url: 'https://app.get-scala.com/motoros',
        targetSector: 'Concessionarie auto, officine, dealer multimarca',
        targetSector_es: 'Concesionarios de autos, talleres, dealers multimarca',
        targetSector_pt: 'Concessionarias de carros, oficinas, dealers multimarca',
        features: [
            'Veicoli — database stock con foto, scheda tecnica, km, storico proprietari, prezzo',
            'Officina — gestione repair order, ordini ricambi, garanzia, tagliandi programmati',
            'Test Drive — prenotazione test drive online con calendar e follow-up automatico',
            'Follow-up Post-Vendita — sequenze automatiche per manutenzione, garanzia, upselling',
            'Valutazione Usato AI — stima basata su Eurotax/Quattroruote con AI adjustment',
            'Permuta — gestione permute con doppia valutazione (ritiro + vendita)',
            'Finanziamento Calculator — simulatore finanziamento/leasing integrato',
        ],
        howToUse: 'MotorOS gestisce concessionaria e officina. Per ogni veicolo: foto, scheda tecnica, prezzo, storico. I clienti prenotano test drive online. Dopo la vendita, il sistema schedula automaticamente i follow-up per tagliandi e manutenzione. L\'officina gestisce repair order e ricambi.',
        howToUse_es: 'MotorOS gestiona concesionario y taller. Para cada vehiculo: fotos, ficha tecnica, precio, historial. Los clientes reservan test drive online. Despues de la venta, el sistema programa automaticamente los seguimientos para revisiones y mantenimiento. El taller gestiona ordenes de reparacion y repuestos.',
        howToUse_pt: 'MotorOS gerencia concessionaria e oficina. Para cada veiculo: fotos, ficha tecnica, preco, historico. Os clientes agendam test drive online. Apos a venda, o sistema agenda automaticamente os acompanhamentos para revisoes e manutencao. A oficina gerencia ordens de reparo e pecas.',
        keywords: ['motoros', 'veicoli', 'auto', 'officina', 'test drive', 'usato', 'permuta', 'concessionaria', 'tagliando', 'finanziamento'],
    },

    travelos: {
        name: 'TravelOS',
        slug: 'travelos',
        url: 'https://app.get-scala.com/travelos',
        targetSector: 'Hotel, B&B, agriturismo, tour operator, agenzie viaggi',
        targetSector_es: 'Hoteles, B&B, agroturismo, tour operadores, agencias de viajes',
        targetSector_pt: 'Hoteis, B&B, agroturismo, operadores de turismo, agencias de viagens',
        features: [
            'Itinerari AI — generazione itinerari personalizzati con AI basati su preferenze',
            'Tour di Gruppo — gestione tour con partecipanti, guide, tappe, budget',
            'Assicurazioni — gestione polizze viaggio integrate',
            'Prenotazioni — booking engine integrato con channel manager',
            'Revenue Management — pricing dinamico basato su domanda, stagionalità, competitor',
            'Guest Experience — check-in digitale, concierge AI, feedback automatico',
        ],
        howToUse: 'TravelOS gestisce l\'intera esperienza turistica. Crea itinerari personalizzati con l\'AI. Gestisci le prenotazioni con il booking engine integrato. Il revenue management ottimizza le tariffe automaticamente. Dopo il soggiorno, il sistema raccoglie feedback e gestisce le recensioni.',
        howToUse_es: 'TravelOS gestiona toda la experiencia turistica. Crea itinerarios personalizados con la IA. Gestiona las reservas con el motor de reservas integrado. El revenue management optimiza las tarifas automaticamente. Despues de la estancia, el sistema recoge feedback y gestiona las resenas.',
        howToUse_pt: 'TravelOS gerencia toda a experiencia turistica. Crie itinerarios personalizados com a IA. Gerencie as reservas com o motor de reservas integrado. O revenue management otimiza as tarifas automaticamente. Apos a estadia, o sistema coleta feedback e gerencia as avaliacoes.',
        keywords: ['travelos', 'itinerari', 'tour', 'assicurazioni', 'hotel', 'prenotazioni hotel', 'revenue management', 'booking', 'viaggio'],
    },

    networkos: {
        name: 'NetworkOS',
        slug: 'networkos',
        url: 'https://network.get-scala.com',
        targetSector: 'Network marketing, MLM, reti distributori, affiliati',
        targetSector_es: 'Network marketing, MLM, redes de distribuidores, afiliados',
        targetSector_pt: 'Network marketing, MLM, redes de distribuidores, afiliados',
        features: [
            'Rete — albero genealogico della rete con livelli, performance, stato',
            'Obiettivi — goal setting per distributori con tracking progressi',
            'Badge & Gamification — sistema di badge e premi per motivare la rete',
            'Commissioni — calcolo automatico commissioni multi-livello, report guadagni',
            'Onboarding — percorsi di onboarding automatizzati per nuovi distributori',
            'Leaderboard — classifiche performance per motivazione e riconoscimento',
            'Formazione — materiali formativi, video, quiz per la rete',
        ],
        howToUse: 'NetworkOS è la piattaforma per gestire reti distributori. Visualizza la tua rete ad albero, traccia le performance di ogni livello, calcola le commissioni automaticamente. I badge e le leaderboard motivano la rete. L\'onboarding automatizzato forma i nuovi distributori.',
        howToUse_es: 'NetworkOS es la plataforma para gestionar redes de distribuidores. Visualiza tu red en arbol, rastrea el rendimiento de cada nivel, calcula las comisiones automaticamente. Los badges y las leaderboards motivan la red. El onboarding automatizado forma a los nuevos distribuidores.',
        howToUse_pt: 'NetworkOS e a plataforma para gerenciar redes de distribuidores. Visualize sua rede em arvore, rastreie o desempenho de cada nivel, calcule as comissoes automaticamente. Os badges e leaderboards motivam a rede. O onboarding automatizado treina os novos distribuidores.',
        keywords: ['networkos', 'network', 'rete', 'distributori', 'mlm', 'commissioni', 'badge', 'leaderboard', 'onboarding', 'gamification'],
    },

    studioos: {
        name: 'StudioOS',
        slug: 'studioos',
        url: 'https://app.get-scala.com/studioos',
        targetSector: 'Studi di architettura, ingegneria, design, progettazione',
        targetSector_es: 'Estudios de arquitectura, ingenieria, diseno, proyectos',
        targetSector_pt: 'Escritorios de arquitetura, engenharia, design, projetos',
        features: [
            'Progetti — gestione progetti con fasi, milestone, deliverable, budget',
            'SAL (Stato Avanzamento Lavori) — traccia l\'avanzamento percentuale e i costi',
            'Timesheet — tracciamento ore per progetto, fase, risorsa',
            'Documenti — gestione documentale con versioning, approvazioni, condivisione',
            'Gantt — diagramma Gantt interattivo con dipendenze e risorse',
            'Budget Tracking — confronto budget preventivo vs. consuntivo in tempo reale',
        ],
        howToUse: 'StudioOS gestisce studi tecnici e di progettazione. Per ogni progetto definisci fasi, milestone e budget. Il SAL traccia l\'avanzamento in tempo reale. Il timesheet registra le ore per calcolare i costi effettivi. Il Gantt visualizza timeline e dipendenze.',
        howToUse_es: 'StudioOS gestiona estudios tecnicos y de proyectos. Para cada proyecto defines fases, hitos y presupuesto. El avance de obra rastrea el progreso en tiempo real. El timesheet registra las horas para calcular los costes reales. El Gantt visualiza cronograma y dependencias.',
        howToUse_pt: 'StudioOS gerencia escritorios tecnicos e de projetos. Para cada projeto voce define fases, marcos e orcamento. O avanco de obra rastreia o progresso em tempo real. O timesheet registra as horas para calcular os custos reais. O Gantt visualiza cronograma e dependencias.',
        keywords: ['studioos', 'progetti', 'sal', 'avanzamento', 'timesheet', 'gantt', 'architettura', 'ingegneria', 'design', 'progettazione'],
    },
};

// ─── i18n labels for knowledge output ───
const KB_LABELS: Record<string, Record<string, string>> = {
    it: { module: 'MODULO', suggested: 'RISPOSTA CONSIGLIATA', howto: 'COME SI USA', features: 'FUNZIONALITÀ PRINCIPALI', vertical: 'VERTICALE', target: 'Per' },
    en: { module: 'MODULE', suggested: 'SUGGESTED ANSWER', howto: 'HOW TO USE', features: 'KEY FEATURES', vertical: 'VERTICAL', target: 'For' },
    es: { module: 'MÓDULO', suggested: 'RESPUESTA SUGERIDA', howto: 'CÓMO SE USA', features: 'FUNCIONALIDADES PRINCIPALES', vertical: 'VERTICAL', target: 'Para' },
    pt: { module: 'MÓDULO', suggested: 'RESPOSTA SUGERIDA', howto: 'COMO USAR', features: 'FUNCIONALIDADES PRINCIPAIS', vertical: 'VERTICAL', target: 'Para' },
};

function kbLabel(lang: string, key: string): string {
    const l = lang.startsWith('en') ? 'en' : lang.startsWith('es') ? 'es' : lang.startsWith('pt') ? 'pt' : 'it';
    return KB_LABELS[l]?.[key] || KB_LABELS['it'][key] || key;
}

// ─── Helper: Find relevant module from user query ───
export function getModuleHelp(query: string, lang: string = 'it'): string | null {
    const lower = query.toLowerCase();
    let bestMatch: ScalaModule | null = null;
    let bestScore = 0;

    for (const mod of Object.values(SCALA_MODULES)) {
        let score = 0;
        for (const kw of mod.keywords) {
            if (lower.includes(kw)) score += kw.length; // longer keywords = more specific
        }
        // Also check common questions
        for (const cq of mod.commonQuestions) {
            const qLower = cq.q.toLowerCase();
            // Check overlap between query words and question words
            const queryWords = lower.split(/\s+/);
            const questionWords = qLower.split(/\s+/);
            const overlap = queryWords.filter(w => w.length > 3 && questionWords.includes(w)).length;
            if (overlap >= 2) score += overlap * 5;
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = mod;
        }
    }

    if (!bestMatch || bestScore < 3) return null;

    const useEn = lang.startsWith('en');

    // Find matching FAQ
    const lowerQuery = query.toLowerCase();
    let bestFaq: { q: string; a: string; q_en?: string; a_en?: string } | null = null;
    let faqScore = 0;
    for (const cq of bestMatch.commonQuestions) {
        const qWords = cq.q.toLowerCase().split(/\s+/);
        const matchWords = qWords.filter(w => w.length > 3 && lowerQuery.includes(w)).length;
        if (matchWords > faqScore) {
            faqScore = matchWords;
            bestFaq = cq;
        }
    }

    const useEs = lang.startsWith('es');
    const usePt = lang.startsWith('pt');
    const desc = (useEn && bestMatch.description_en) ? bestMatch.description_en
        : (useEs && bestMatch.description_es) ? bestMatch.description_es
        : (usePt && bestMatch.description_pt) ? bestMatch.description_pt
        : bestMatch.description;
    const howto = (useEn && bestMatch.howToUse_en) ? bestMatch.howToUse_en
        : (useEs && bestMatch.howToUse_es) ? bestMatch.howToUse_es
        : (usePt && bestMatch.howToUse_pt) ? bestMatch.howToUse_pt
        : bestMatch.howToUse;
    const feats = (useEn && bestMatch.features_en) ? bestMatch.features_en : bestMatch.features;

    let result = `[${kbLabel(lang, 'module')}: ${bestMatch.name}]\n`;
    result += `${desc}\n`;
    result += `URL: ${bestMatch.url}\n`;
    if (bestFaq && faqScore >= 1) {
        const faqAnswer = (useEn && bestFaq.a_en) ? bestFaq.a_en : bestFaq.a;
        result += `\n${kbLabel(lang, 'suggested')}:\n${faqAnswer}\n`;
    }
    result += `\n${kbLabel(lang, 'howto')}:\n${howto}\n`;
    result += `\n${kbLabel(lang, 'features')}:\n${feats.map(f => `• ${f}`).join('\n')}`;

    return result;
}

// ─── Helper: Find relevant vertical from user query ───
export function getVerticalHelp(query: string, lang: string = 'it'): string | null {
    const lower = query.toLowerCase();
    let bestMatch: ScalaVertical | null = null;
    let bestScore = 0;

    for (const vert of Object.values(SCALA_VERTICALS)) {
        let score = 0;
        for (const kw of vert.keywords) {
            if (lower.includes(kw)) score += kw.length;
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = vert;
        }
    }

    if (!bestMatch || bestScore < 4) return null;

    const useEn = lang.startsWith('en');
    const useEs = lang.startsWith('es');
    const usePt = lang.startsWith('pt');
    const target = (useEn && bestMatch.targetSector_en) ? bestMatch.targetSector_en
        : (useEs && bestMatch.targetSector_es) ? bestMatch.targetSector_es
        : (usePt && bestMatch.targetSector_pt) ? bestMatch.targetSector_pt
        : bestMatch.targetSector;
    const howto = (useEn && bestMatch.howToUse_en) ? bestMatch.howToUse_en
        : (useEs && bestMatch.howToUse_es) ? bestMatch.howToUse_es
        : (usePt && bestMatch.howToUse_pt) ? bestMatch.howToUse_pt
        : bestMatch.howToUse;
    const feats = (useEn && bestMatch.features_en) ? bestMatch.features_en : bestMatch.features;

    let result = `[${kbLabel(lang, 'vertical')}: ${bestMatch.name}]\n`;
    result += `${kbLabel(lang, 'target')}: ${target}\n`;
    result += `URL: ${bestMatch.url}\n`;
    result += `\n${kbLabel(lang, 'howto')}:\n${howto}\n`;
    result += `\n${kbLabel(lang, 'features')}:\n${feats.map(f => `• ${f}`).join('\n')}`;

    return result;
}

// ─── Detect if query is about SCALA platform usage ───
export function isScalaPlatformQuery(text: string): boolean {
    const lower = text.toLowerCase();
    const platformSignals = [
        // Direct module references
        'bmc', 'swot', 'pareto', 'porter', 'okr', 'north star', 'process analyzer',
        'balance sheet', 'bilancio', 'pilot', 'crm', 'pipeline', 'lead scoring',
        'knowledge base', 'ai advisor', 'ai coach', 'roadmap',
        // Vertical references
        'praxisos', 'agencyos', 'dineos', 'dermalyos', 'propertyos', 'motoros', 'travelos', 'networkos', 'studioos',
        // Usage patterns
        'come si usa', 'come faccio', 'come creo', 'come imposto', 'come aggiungo',
        'come funziona il', 'come funziona la', 'dove trovo', 'come carico',
        'non trovo', 'non riesco', 'mi aiuti con', 'guidami', 'help me with',
        'nella piattaforma', 'su scala', 'in scala', 'sulla piattaforma',
        'il modulo', 'la sezione', 'dal menu',
        // Action verbs for platform
        'inserisci', 'crea un', 'aggiungi un', 'analizza', 'genera', 'esporta',
        'carica un', 'importa', 'configura',
        // Pricing signals (P2 audit fix)
        'prezzo', 'prezzi', 'quanto costa', 'quanto costano',
        // 'costa' e 'costano' da soli NO: in italiano "costa" e anche il
        // litorale e "costoso" un aggettivo qualsiasi. La frase intera basta,
        // e il segnale singolo faceva scattare il listino su "un tavolo vista
        // costa".
        'pricing', 'price', 'cost', 'how much', 'plan', 'piani',
        'precio', 'cuesta', 'plano', 'preço',
        'abbonamento', 'subscription', 'trial', 'free', 'gratuito',
    ];

    // Le frasi (piu parole) si cercano come sottostringa: "come si usa" dentro
    // una domanda piu lunga e esattamente cio che vogliamo trovare.
    const frasi = platformSignals.filter(s => s.includes(' '));
    if (frasi.some(f => lower.includes(f))) return true;

    // Le parole singole NO: cercarle come sottostringa produceva falsi
    // positivi seri, perche i segnali corti vivono dentro parole comuni.
    //
    //   "un tavolo vista costa"        -> costa
    //   "il vino e costoso"            -> cost
    //   "vorrei un costume da bagno"   -> cost
    //   "sono un freelance"            -> free
    //   "lavoro nel settore industriale" -> trial   (indus-TRIAL-e)
    //
    // In tutti e cinque i casi SARA iniettava il listino della piattaforma
    // nella conversazione: un cliente che prenota la cena si sentiva
    // rispondere sugli abbonamenti da 97 euro al mese.
    //
    // \p{L} e \p{N} invece di \w perche i messaggi sono in italiano, spagnolo
    // e portoghese: con \w, "però" spezzerebbe sulla lettera accentata.
    const parole = platformSignals.filter(s => !s.includes(' '));
    const alternative = parole.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const confineDiParola = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${alternative})(?:[^\\p{L}\\p{N}]|$)`, 'u');
    return confineDiParola.test(lower);
}

// ─── Pricing knowledge (aggiornato 2026-04-20) ───
export const SCALA_PRICING = `
SCALA AI OS — Pricing 2026 (in vigore):

• FREE — €0/sempre. Piano gratuito per esplorare SCALA.
  Include: tutti i moduli Core in anteprima, 20 verticali in anteprima, 1 utente, 500 AI credits/mese.

• GROWTH — €97/mese (€970/anno). Per automatizzare.
  Include: tutti e 5 i moduli SCALA, fino a 5 verticali a scelta,
  30.000 AI credits/mese, fino a 6 utenti team. NON include SARA WhatsApp.

• SCALE — €197/mese (€1970/anno). Per scalare davvero.
  Tutto di GROWTH + SARA AI WhatsApp 24/7 multi-lingua (IT/EN/ES/PT),
  TUTTI i 20 verticali, Content Repurposer, Workflow Builder,
  100.000 AI credits/mese, utenti illimitati, account manager dedicato.

• SOLO SARA — €9,90/mese (offerta separata per freelance e P.IVA): SOLO l'assistente SARA su WhatsApp (prenotazioni, follow-up, multilingua), senza la piattaforma SCALA completa. Ideale per chi lavora da solo. SÌ, esiste.

Trial: 14 giorni gratis SOLO su GROWTH, nessuna carta richiesta. Nessun trial su SCALE.
Fatturazione: mensile o annuale con sconto ~17%.
Add-on credits: €5 ogni 1000 AI credits extra.
Il contatto email è contact@get-scala.com.

ATTENZIONE — acronimo S.C.A.L.A.:
S = Strategy, C = Confirmation (non "Cash"), A = Activation, L = Leverage, A = Acceleration.
`.trim();

export const SCALA_PRICING_EN = `
SCALA AI OS — Pricing 2026 (current):

• FREE — €0/forever. Free plan to explore SCALA.
  Includes: all Core modules preview, 20 verticals preview, 1 user, 500 AI credits/month.

• GROWTH — €97/month (€970/year). To automate.
  Includes: all 5 SCALA modules, up to 5 verticals of your choice,
  30,000 AI credits/month, up to 6 team users. Does NOT include SARA WhatsApp.

• SCALE — €197/month (€1970/year). To truly scale.
  Everything in GROWTH + SARA AI WhatsApp 24/7 multilingual (IT/EN/ES/PT),
  ALL 20 verticals, Content Repurposer, Workflow Builder,
  100,000 AI credits/month, unlimited users, dedicated account manager.

• SOLO SARA — €9.90/month (separate offer for freelancers): JUST the SARA assistant on WhatsApp (bookings, follow-up, multilingual), without the full SCALA platform. For solo professionals. YES, it exists.

Trial: 14 days free on GROWTH ONLY, no credit card required. No trial on SCALE.
Billing: monthly or annual with ~17% discount.
Add-on credits: €5 per 1000 extra AI credits.
Contact email: contact@get-scala.com.

NOTE — S.C.A.L.A. acronym:
S = Strategy, C = Confirmation (not "Cash"), A = Activation, L = Leverage, A = Acceleration.
`.trim();

export const SCALA_PRICING_ES = `
SCALA AI OS — Precios 2026 (vigentes):

- FREE — €0/siempre. Plan gratuito para explorar SCALA.
  Incluye: todos los modulos Core en vista previa, 20 verticales en vista previa, 1 usuario, 500 creditos AI/mes.

- GROWTH — €97/mes (€970/ano). Para automatizar.
  Incluye: los 5 modulos SCALA, hasta 5 verticales a eleccion,
  30.000 creditos AI/mes, hasta 6 usuarios de equipo. NO incluye SARA WhatsApp.

- SCALE — €197/mes (€1970/ano). Para escalar de verdad.
  Todo de GROWTH + SARA AI WhatsApp 24/7 multilingue (IT/EN/ES/PT),
  TODOS los 20 verticales, Content Repurposer, Workflow Builder,
  100.000 creditos AI/mes, usuarios ilimitados, account manager dedicado.

• SOLO SARA — €9,90/mes (oferta separada para freelancers): SOLO el asistente SARA en WhatsApp (reservas, follow-up, multilingue), sin la plataforma SCALA completa. Para profesionales independientes. SÍ, existe.

Trial: 14 dias gratis SOLO en GROWTH, sin tarjeta requerida. Sin trial en SCALE.
Facturacion: mensual o anual con descuento ~17%.
Creditos extra: €5 por cada 1000 creditos AI extra.
Email de contacto: contact@get-scala.com.

NOTA — acronimo S.C.A.L.A.:
S = Strategy, C = Confirmation (no "Cash"), A = Activation, L = Leverage, A = Acceleration.
`.trim();

export const SCALA_PRICING_PT = `
SCALA AI OS — Precos 2026 (vigentes):

- FREE — €0/sempre. Plano gratuito para explorar o SCALA.
  Inclui: todos os modulos Core em preview, 20 verticais em preview, 1 usuario, 500 creditos AI/mes.

- GROWTH — €97/mes (€970/ano). Para automatizar.
  Inclui: todos os 5 modulos SCALA, ate 5 verticais a escolha,
  30.000 creditos AI/mes, ate 6 usuarios de equipe. NAO inclui SARA WhatsApp.

- SCALE — €197/mes (€1970/ano). Para escalar de verdade.
  Tudo do GROWTH + SARA AI WhatsApp 24/7 multilingue (IT/EN/ES/PT),
  TODOS os 20 verticais, Content Repurposer, Workflow Builder,
  100.000 creditos AI/mes, usuarios ilimitados, account manager dedicado.

• SOLO SARA — €9,90/mes (oferta separada para freelancers): SOLO el asistente SARA en WhatsApp (reservas, follow-up, multilingue), sin la plataforma SCALA completa. Para profesionales independientes. SÍ, existe.

Trial: 14 dias gratis APENAS no GROWTH, sem cartao necessario. Sem trial no SCALE.
Faturamento: mensal ou anual com desconto ~17%.
Creditos extra: €5 por cada 1000 creditos AI extras.
Email de contato: contact@get-scala.com.

NOTA — acronimo S.C.A.L.A.:
S = Strategy, C = Confirmation (nao "Cash"), A = Activation, L = Leverage, A = Acceleration.
`.trim();

function isPricingQuery(query: string): boolean {
    const lower = query.toLowerCase();

    // Frasi: si cercano come sottostringa, ed e giusto cosi.
    const frasi = [
        'quanto costa', 'quanto costano', 'quanto custa', 'quanto custam',
        'how much', 'cuanto cuesta', 'cuánto cuesta', 'cuanto cuestan',
        'piano gratuito', 'piani disponibili', 'listino prezzi',
    ];
    if (frasi.some(f => lower.includes(f))) return true;

    // Parole singole, cercate con i confini di parola.
    //
    // Tolti rispetto a prima, e ognuno faceva danno da solo:
    //
    //   '49','149','298'  numeri nudi, cercati come sottostringa. Un numero di
    //                     telefono contiene quasi sempre "49": "+39 349 12345"
    //                     faceva iniettare il listino intero. Ed erano anche
    //                     OBSOLETI — i prezzi veri sono 97, 197, 970, 1970.
    //   '€'               un ristorante che scrive "il vino costa 25€" non sta
    //                     chiedendo il listino della piattaforma.
    //   'quanto'          "quanto tempo ci vuole", "quanto dista".
    //   'piano'           "siamo al piano terra", "vai piano".
    //   'costa','costano' "un tavolo vista costa".
    //
    // Restavano nella conversazione di CHIUNQUE: il listino della piattaforma
    // finiva nel contesto del modello mentre un cliente prenotava la cena, e il
    // modello veniva invitato a parlargli di abbonamenti da 97 euro.
    const parole = [
        'prezzo', 'prezzi', 'costo', 'costi', 'piani', 'tariffe', 'tariffa',
        'pricing', 'price', 'prices', 'cost', 'plan', 'plans',
        'precio', 'precios', 'cuesta', 'cuestan', 'planes',
        'preço', 'preços', 'custa', 'custam', 'plano', 'planos',
        'abbonamento', 'abbonamenti', 'subscription', 'suscripción', 'assinatura',
    ];
    const alternative = parole.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${alternative})(?:[^\\p{L}\\p{N}]|$)`, 'u').test(lower);
}

// ─── Build knowledge context for AI prompt ───
export function buildKnowledgeContext(query: string, lang: string = 'it'): string {
    const parts: string[] = [];

    if (isPricingQuery(query)) {
        if (lang.startsWith('en')) parts.push(SCALA_PRICING_EN);
        else if (lang.startsWith('es')) parts.push(SCALA_PRICING_ES);
        else if (lang.startsWith('pt')) parts.push(SCALA_PRICING_PT);
        else parts.push(SCALA_PRICING);
    }

    const moduleHelp = getModuleHelp(query, lang);
    if (moduleHelp) parts.push(moduleHelp);

    const verticalHelp = getVerticalHelp(query, lang);
    if (verticalHelp) parts.push(verticalHelp);

    if (parts.length === 0) return '';

    return `\n═══ SCALA PLATFORM KNOWLEDGE ═══\n${parts.join('\n\n')}\n═══════════════════════════════\n`;
}
