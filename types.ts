
export enum ViewType {
  TOP = 'top',
  FRONT = 'front',
  SIDE = 'side',
  BACK = 'back',
  DETAIL = 'detail'
}

export enum CameraAngle {
  WIDE = 'Wide Shot (Toàn cảnh)',
  MEDIUM = 'Medium Shot (Trung cảnh)',
  CLOSEUP = 'Close-up (Cận cảnh)',
  TOP_DOWN = 'Top-down (Từ trên xuống)',
  SIDE_PERSPECTIVE = 'Side Perspective (Góc nghiêng)',
  DETAIL_MACRO = 'Detail Shot (Cận cảnh chi tiết)'
}

export enum DesignStyle {
  MODERN = 'Modern',
  MINIMAL = 'Minimal',
  JAPANDI = 'Japandi',
  SCANDINAVIAN = 'Scandinavian',
  LUXURY = 'Luxury',
  INDUSTRIAL = 'Industrial',
  CLASSIC = 'Classic',
  CONTEMPORARY = 'Contemporary'
}

export enum RoomType {
  LIVING_ROOM = 'Living Room',
  BEDROOM = 'Bedroom',
  GARDEN = 'Garden',
  FACADE = 'Facade',
  SHOWROOM = 'Showroom',
  OFFICE = 'Office',
  KITCHEN = 'Kitchen',
  DINING_ROOM = 'Dining Room',
  LOBBY = 'Lobby'
}

export enum LightingEnvironment {
  MORNING = 'Natural Morning',
  GOLDEN_HOUR = 'Golden Hour (Sunset)',
  HIGH_NOON = 'High Noon (Bright)',
  STUDIO = 'Studio Professional',
  NIGHT_INTERIOR = 'Night (Warm Lights)',
  MOONLIGHT = 'Night (Moonlight)',
  OVERCAST = 'Soft Overcast',
  CINEMATIC = 'Cinematic Moody'
}

export enum InputStatus {
  IMPORTED = 'Imported',
  CONFIRMED = 'Confirmed',
  REMOVED = 'Removed',
  REPLACED = 'Replaced'
}

export interface RenderParameters {
  spaceType: 'Interior' | 'Exterior';
  roomType: RoomType;
  lightingEnv: LightingEnvironment;
  lightingDirection: 'Front' | 'Side' | 'Back' | 'Overhead';
  designStyle: DesignStyle;
  colorPalette: string;
  mood: string;
  allowExternalItems: boolean;
}

export interface StagingParameters extends RenderParameters {
  layoutDensity: 'Minimal' | 'Balanced' | 'Spacious';
  arrangementStyle: 'Focal Point' | 'Symmetrical' | 'Organic';
  viewpoints: CameraAngle[];
}

export interface ProductImage {
  id: string;
  originalUrl: string;
  renderedUrl?: string;
  viewType: ViewType;
  inputStatus: InputStatus;
  renderStatus: 'pending' | 'processing' | 'completed' | 'error';
  isSelected?: boolean;
}

export interface StagedScene {
  id: string;
  productIds: string[];
  angle: CameraAngle;
  renderedUrl?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
}

export interface Collection {
  id: string;
  name: string;
  mode: 'Individual' | 'Staging';
  parameters: RenderParameters;
  stagingParameters: StagingParameters;
  images: ProductImage[];
  stagedScenes: StagedScene[];
  referenceImage?: string; // Mood board / Concept
  isConfirmed: boolean;
}
