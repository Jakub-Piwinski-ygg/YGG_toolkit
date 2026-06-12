import { CropTool, cropMeta } from './CropTool.jsx';
import { ScalerTool, scalerMeta } from './ScalerTool.jsx';
import { ConverterTool, converterMeta } from './ConverterTool.jsx';
import { BlurTool, blurMeta } from './BlurTool.jsx';
import { GaussianBlurTool, gaussBlurMeta } from './GaussianBlurTool.jsx';
import { RgbaMaskTool, rgbaMeta } from './RgbaMaskTool.jsx';
import { GreyToAlphaTool, greyToAlphaMeta } from './GreyToAlphaTool.jsx';
import { GradientMapTool, gradientMapMeta } from './GradientMapTool.jsx';
import { OutlineTool, outlineMeta } from './OutlineTool.jsx';
import { AtlasPackerTool, atlasMeta } from './AtlasPackerTool.jsx';
import { PaylinesTool, paylinesMeta } from './PaylinesTool.jsx';
import { FontPreviewTool, fontPreviewMeta } from './FontPreviewTool.jsx';
import { RepoContentBrowserTool, repoContentBrowserMeta } from './RepoContentBrowserTool.jsx';
import { AssetCheckerTool, assetCheckerMeta } from './AssetChecker/AssetCheckerTool.jsx';
import { ProjectScaffoldTool, projectScaffoldMeta } from './ProjectScaffoldTool.jsx';
import { CharExtractorTool, charExtractorMeta } from './CharExtractorTool.jsx';
import { CheatTool, cheatToolMeta } from './CheatTool/index.jsx';
import { TemplatesTool, templatesMeta } from './TemplatesTool.jsx';
import { SceneStudioTool, sceneStudioMeta } from './SceneStudio/SceneStudioTool.jsx';

const ART = [
  { meta: cropMeta, Component: CropTool },
  { meta: scalerMeta, Component: ScalerTool },
  { meta: converterMeta, Component: ConverterTool },
  { meta: blurMeta, Component: BlurTool },
  { meta: gaussBlurMeta, Component: GaussianBlurTool },
  { meta: rgbaMeta, Component: RgbaMaskTool },
  { meta: greyToAlphaMeta, Component: GreyToAlphaTool },
  { meta: gradientMapMeta, Component: GradientMapTool },
  { meta: outlineMeta, Component: OutlineTool },
  { meta: atlasMeta, Component: AtlasPackerTool },
  { meta: paylinesMeta, Component: PaylinesTool },
  { meta: fontPreviewMeta, Component: FontPreviewTool }
];

const REVIEW = [
  { meta: assetCheckerMeta, Component: AssetCheckerTool },
  { meta: projectScaffoldMeta, Component: ProjectScaffoldTool },
  { meta: charExtractorMeta, Component: CharExtractorTool },
  { meta: repoContentBrowserMeta, Component: RepoContentBrowserTool },
  { meta: templatesMeta, Component: TemplatesTool }
];

const CHEETS = [
  { meta: cheatToolMeta, Component: CheatTool }
];

const STUDIO = [
  { meta: sceneStudioMeta, Component: SceneStudioTool }
];

export const TOOL_CATEGORIES = [
  { id: 'arttools', label: 'Art Tools', icon: '🎨', tools: ART },
  { id: 'review', label: 'Asset Pipeline', icon: '🏗️', tools: REVIEW },
  { id: 'studio', label: 'Scene Studio', icon: '🎬', tools: STUDIO },
  { id: 'cheets', label: 'Cheets', icon: '🎲', tools: CHEETS }
];

// Soft redirects for legacy `?tool=` URLs after the Content category was merged
// into Asset Pipeline as a single Repo Content Browser tool.
export const TOOL_ALIASES = {
  contentbrowser: repoContentBrowserMeta.id,
  soundbrowser: repoContentBrowserMeta.id,
  // Slot Machine retired in Phase 5 — superseded by the Scene Studio Spinner
  // object (see react-app/SPINNER.md).
  slotmachine: sceneStudioMeta.id
};

export function resolveToolId(toolId) {
  return TOOL_ALIASES[toolId] || toolId;
}

// Flattened convenience list — used by anything that needs to look up a tool
// by id without caring which category it lives in.
export const ART_TOOLS = TOOL_CATEGORIES.flatMap((c) => c.tools);

export function categoryOfTool(toolId) {
  const resolved = resolveToolId(toolId);
  for (const cat of TOOL_CATEGORIES) {
    if (cat.tools.some((t) => t.meta.id === resolved)) return cat.id;
  }
  return TOOL_CATEGORIES[0].id;
}
