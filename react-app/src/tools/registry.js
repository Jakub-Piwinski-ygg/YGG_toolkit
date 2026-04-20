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

// As tools are ported, add an entry here. Each entry owns its own file under
// src/tools/. The shell has no tool-specific logic — just renders whichever
// component is active and invokes its registered runner on RUN.
export const ART_TOOLS = [
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
  { meta: slotMachineMeta, Component: SlotMachineTool },
  { meta: contentBrowserMeta, Component: ContentBrowserTool }
];
