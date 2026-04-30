import { CropTool, cropMeta } from './CropTool.jsx';
import { ScalerTool, scalerMeta } from './ScalerTool.jsx';
import { WebPTool, webpMeta } from './WebPTool.jsx';
import { BlurTool, blurMeta } from './BlurTool.jsx';
import { GaussianBlurTool, gaussBlurMeta } from './GaussianBlurTool.jsx';
import { RgbaMaskTool, rgbaMeta } from './RgbaMaskTool.jsx';
import { GreyToAlphaTool, greyToAlphaMeta } from './GreyToAlphaTool.jsx';
import { GradientMapTool, gradientMapMeta } from './GradientMapTool.jsx';
import { OutlineTool, outlineMeta } from './OutlineTool.jsx';
import { AtlasPackerTool, atlasMeta } from './AtlasPackerTool.jsx';
import { PaylinesTool, paylinesMeta } from './PaylinesTool.jsx';
import { FontPreviewTool, fontPreviewMeta } from './FontPreviewTool.jsx';
import { SlotMachineTool, slotMachineMeta } from './SlotMachineTool.jsx';
import { ContentBrowserTool, contentBrowserMeta } from './ContentBrowserTool.jsx';
import { SoundBrowserTool, soundBrowserMeta } from './SoundBrowserTool.jsx';
import { AssetCheckerTool, assetCheckerMeta } from './AssetChecker/AssetCheckerTool.jsx';
import { ProjectScaffoldTool, projectScaffoldMeta } from './ProjectScaffoldTool.jsx';

const ART = [
  { meta: cropMeta, Component: CropTool },
  { meta: scalerMeta, Component: ScalerTool },
  { meta: webpMeta, Component: WebPTool },
  { meta: blurMeta, Component: BlurTool },
  { meta: gaussBlurMeta, Component: GaussianBlurTool },
  { meta: rgbaMeta, Component: RgbaMaskTool },
  { meta: greyToAlphaMeta, Component: GreyToAlphaTool },
  { meta: gradientMapMeta, Component: GradientMapTool },
  { meta: outlineMeta, Component: OutlineTool },
  { meta: atlasMeta, Component: AtlasPackerTool },
  { meta: paylinesMeta, Component: PaylinesTool },
  { meta: fontPreviewMeta, Component: FontPreviewTool },
  { meta: slotMachineMeta, Component: SlotMachineTool }
];

const BROWSER = [
  { meta: contentBrowserMeta, Component: ContentBrowserTool },
  { meta: soundBrowserMeta, Component: SoundBrowserTool }
];

const REVIEW = [
  { meta: assetCheckerMeta, Component: AssetCheckerTool },
  { meta: projectScaffoldMeta, Component: ProjectScaffoldTool }
];

export const TOOL_CATEGORIES = [
  { id: 'arttools', label: 'Art Tools', icon: '🎨', tools: ART },
  { id: 'browser', label: 'Content', icon: '📦', tools: BROWSER },
  { id: 'review', label: 'Review', icon: '🔍', tools: REVIEW }
];

// Flattened convenience list — used by anything that needs to look up a tool
// by id without caring which category it lives in.
export const ART_TOOLS = TOOL_CATEGORIES.flatMap((c) => c.tools);

export function categoryOfTool(toolId) {
  for (const cat of TOOL_CATEGORIES) {
    if (cat.tools.some((t) => t.meta.id === toolId)) return cat.id;
  }
  return TOOL_CATEGORIES[0].id;
}
