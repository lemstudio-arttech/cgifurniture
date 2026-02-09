
import React, { useState, useRef, useEffect } from 'react';
import { 
  Collection, 
  ProductImage, 
  ViewType, 
  RoomType, 
  DesignStyle, 
  LightingEnvironment,
  RenderParameters, 
  StagingParameters,
  CameraAngle,
  StagedScene,
  InputStatus
} from './types';
import { GeminiService } from './services/geminiService';
import Button from './components/Button';

// Fix: Avoid conflict with existing global AIStudio type by using any.
// The error suggested 'aistudio' must be of type 'AIStudio'.
declare global {
  interface Window {
    aistudio: any;
  }
}

const INITIAL_PARAMS: RenderParameters = {
  spaceType: 'Interior',
  roomType: RoomType.LIVING_ROOM,
  lightingEnv: LightingEnvironment.MORNING,
  lightingDirection: 'Side',
  designStyle: DesignStyle.MODERN,
  colorPalette: 'Neutral Earthy Tones',
  mood: 'Warm and inviting',
  allowExternalItems: false
};

const INITIAL_STAGING_PARAMS: StagingParameters = {
  ...INITIAL_PARAMS,
  layoutDensity: 'Balanced',
  arrangementStyle: 'Focal Point',
  viewpoints: [CameraAngle.WIDE, CameraAngle.TOP_DOWN, CameraAngle.SIDE_PERSPECTIVE, CameraAngle.CLOSEUP]
};

interface EditingState {
  type: 'product' | 'scene';
  id: string;
  imageUrl: string;
  prompt: string;
  isProcessing: boolean;
}

const App: React.FC = () => {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderStatus, setRenderStatus] = useState<string | null>(null);
  const [editingState, setEditingState] = useState<EditingState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasPaidKey, setHasPaidKey] = useState(false);
  
  const geminiRef = useRef<GeminiService | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const moodBoardRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    geminiRef.current = new GeminiService();
    checkApiKey();
  }, []);

  const checkApiKey = async () => {
    if (window.aistudio) {
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasPaidKey(selected);
    }
  };

  const handleSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      // Assume success after opening dialog as per instructions to avoid race conditions
      setHasPaidKey(true);
      setErrorMessage(null);
    }
  };

  const handleCreateCollection = () => {
    setCollection({
      id: Math.random().toString(36).substr(2, 9),
      name: 'New Project',
      mode: 'Individual',
      parameters: { ...INITIAL_PARAMS },
      stagingParameters: { ...INITIAL_STAGING_PARAMS },
      images: [],
      stagedScenes: [],
      isConfirmed: false
    });
  };

  const handleAddImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !collection) return;
    const newImages: ProductImage[] = Array.from(e.target.files).map((file: File) => ({
      id: Math.random().toString(36).substr(2, 9),
      originalUrl: URL.createObjectURL(file),
      viewType: ViewType.FRONT,
      inputStatus: InputStatus.IMPORTED,
      renderStatus: 'pending'
    }));
    setCollection(prev => prev ? { ...prev, images: [...prev.images, ...newImages], isConfirmed: false } : null);
    if (e.target) e.target.value = '';
  };

  const handleMoodBoardUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !collection) return;
    const url = URL.createObjectURL(e.target.files[0]);
    setCollection({ ...collection, referenceImage: url });
    if (e.target) e.target.value = '';
  };

  const handleRemoveMoodBoard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!collection) return;
    setCollection({ ...collection, referenceImage: undefined });
  };

  const handleUpdateParams = (field: string, value: any) => {
    if (!collection) return;
    if (collection.mode === 'Individual') {
      setCollection({ ...collection, parameters: { ...collection.parameters, [field]: value } });
    } else {
      setCollection({ ...collection, stagingParameters: { ...collection.stagingParameters, [field]: value } });
    }
  };

  const toggleViewpoint = (angle: CameraAngle) => {
    if (!collection) return;
    const current = collection.stagingParameters.viewpoints;
    const next = current.includes(angle) 
      ? current.filter(v => v !== angle) 
      : [...current, angle];
    handleUpdateParams('viewpoints', next);
  };

  const toggleImageSelection = (id: string) => {
    setCollection(prev => prev ? {
      ...prev,
      images: prev.images.map(img => img.id === id ? { ...img, isSelected: !img.isSelected } : img)
    } : null);
  };

  const handleRender = async () => {
    if (!collection || !collection.isConfirmed || !geminiRef.current) return;
    setIsRendering(true);
    setErrorMessage(null);

    try {
      if (collection.mode === 'Individual') {
        const imagesToRender = collection.images.filter(img => img.inputStatus === InputStatus.CONFIRMED && img.renderStatus !== 'completed');
        for (let i = 0; i < imagesToRender.length; i++) {
          const img = imagesToRender[i];
          setRenderStatus(`Rendering Product ${i + 1}/${imagesToRender.length}...`);
          updateImageStatus(img.id, 'processing');
          const url = await geminiRef.current.renderProduct(img, collection.parameters, collection.referenceImage);
          if (url) updateImageStatus(img.id, 'completed', url);
        }
      } else {
        const selected = collection.images.filter(img => img.isSelected && img.inputStatus === InputStatus.CONFIRMED);
        if (selected.length === 0) {
          setErrorMessage("Vui lòng chọn ít nhất một sản phẩm để bắt đầu Room Staging.");
          setIsRendering(false);
          return;
        }

        const sortedAngles = [...collection.stagingParameters.viewpoints].sort((a, b) => {
          if (a === CameraAngle.WIDE) return -1;
          if (b === CameraAngle.WIDE) return 1;
          return 0;
        });

        const scenes: StagedScene[] = sortedAngles.map(angle => ({
          id: Math.random().toString(36).substr(2, 9),
          productIds: selected.map(p => p.id),
          angle,
          status: 'pending'
        }));

        setCollection(prev => prev ? { ...prev, stagedScenes: [...prev.stagedScenes, ...scenes] } : null);

        let masterShotUrl: string | undefined = undefined;

        for (let i = 0; i < scenes.length; i++) {
          const scene = scenes[i];
          const isMaster = i === 0;
          
          setRenderStatus(isMaster ? "🎨 Establishing Master Shot..." : `📸 Relocating to Angle: ${scene.angle}...`);
          updateSceneStatus(scene.id, 'processing');
          
          const url = await geminiRef.current.stageRoom(
            selected, 
            collection.stagingParameters, 
            scene.angle, 
            collection.referenceImage,
            masterShotUrl
          );

          if (url) {
            updateSceneStatus(scene.id, 'completed', url);
            if (isMaster) masterShotUrl = url;
          }
        }
      }
    } catch (err: any) {
      console.error("Render error:", err);
      // Fix: Handle 'Requested entity was not found' by resetting key selection
      if (err.message?.includes("Requested entity was not found")) {
        setHasPaidKey(false);
        handleSelectKey();
        return;
      }

      if (err.message?.includes("API_KEY_MISSING") || err.message?.includes("429") || err.message?.includes("EXHAUSTED")) {
        setErrorMessage("Lỗi giới hạn (Quota). Để sử dụng mô hình tạo ảnh CGI, bạn vui lòng nhấn nút 'Kết nối API Key trả phí' và chọn một dự án Google Cloud có bật Billing.");
      } else {
        setErrorMessage(`Lỗi hệ thống: ${err.message || "Đã có sự cố xảy ra, vui lòng thử lại."}`);
      }
    } finally {
      setIsRendering(false);
      setRenderStatus(null);
    }
  };

  const handleApplyEdit = async () => {
    if (!editingState || !geminiRef.current || !editingState.prompt) return;
    setEditingState(prev => prev ? { ...prev, isProcessing: true } : null);
    
    try {
      const newUrl = await geminiRef.current.editImage(editingState.imageUrl, editingState.prompt);
      if (newUrl) {
        if (editingState.type === 'product') {
          updateImageStatus(editingState.id, 'completed', newUrl);
        } else {
          updateSceneStatus(editingState.id, 'completed', newUrl);
        }
        setEditingState(null);
      }
    } catch (err: any) {
      // Fix: Handle 'Requested entity was not found' by resetting key selection
      if (err.message?.includes("Requested entity was not found")) {
        setHasPaidKey(false);
        handleSelectKey();
        return;
      }
      alert(`Lỗi chỉnh sửa: ${err.message}`);
    } finally {
      setEditingState(prev => prev ? { ...prev, isProcessing: false } : null);
    }
  };

  const updateImageStatus = (id: string, status: any, url?: string) => {
    setCollection(prev => prev ? {
      ...prev,
      images: prev.images.map(i => i.id === id ? { ...i, renderStatus: status, ...(url && { renderedUrl: url }) } : i)
    } : null);
  };

  const updateSceneStatus = (id: string, status: any, url?: string) => {
    setCollection(prev => prev ? {
      ...prev,
      stagedScenes: prev.stagedScenes.map(s => s.id === id ? { ...s, status: status, ...(url && { renderedUrl: url }) } : s)
    } : null);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans selection:bg-indigo-100">
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between py-4">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white text-2xl font-black shadow-xl shadow-indigo-200">L</div>
            <div>
              <h1 className="text-xl font-black text-gray-900 leading-none">Lem Studio <span className="text-indigo-600">AI</span></h1>
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1 block">Professional CGI Rendering</span>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {!hasPaidKey && (
              <Button 
                onClick={handleSelectKey} 
                variant="outline" 
                size="sm" 
                className="rounded-xl border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 font-black flex items-center"
              >
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                Kết nối API Key trả phí
              </Button>
            )}
            
            {collection && (
              <div className="flex items-center space-x-6">
                <div className="bg-gray-100 p-1.5 rounded-2xl flex">
                  <button 
                    onClick={() => setCollection({...collection, mode: 'Individual'})}
                    className={`px-6 py-2 text-xs font-black rounded-xl transition-all ${collection.mode === 'Individual' ? 'bg-white shadow-lg text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    SINGLE
                  </button>
                  <button 
                    onClick={() => setCollection({...collection, mode: 'Staging'})}
                    className={`px-6 py-2 text-xs font-black rounded-xl transition-all ${collection.mode === 'Staging' ? 'bg-white shadow-lg text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    ROOMS
                  </button>
                </div>
                <div className="h-8 w-px bg-gray-200"></div>
                <Button 
                  onClick={handleRender} 
                  isLoading={isRendering} 
                  variant="primary" 
                  size="sm" 
                  disabled={!collection.isConfirmed || collection.images.length === 0} 
                  className="rounded-xl font-black px-8 py-3 bg-indigo-600 shadow-xl shadow-indigo-100"
                >
                  {collection.mode === 'Staging' ? 'Start Staging' : 'Batch Render'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {renderStatus && (
        <div className="bg-indigo-600 text-white text-center py-2.5 text-[11px] font-black tracking-widest uppercase animate-pulse sticky top-20 z-40 shadow-xl">
          <span className="mr-2">⚡</span> {renderStatus}
        </div>
      )}

      {errorMessage && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 backdrop-blur-md bg-black/20 animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl p-8 border border-red-100">
            <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-red-500 mb-6 mx-auto">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h3 className="text-xl font-black text-center text-gray-900 mb-4">Quota Limit Reached</h3>
            <p className="text-gray-500 text-center text-sm font-medium leading-relaxed mb-8">{errorMessage}</p>
            <div className="flex flex-col space-y-3">
              <Button variant="primary" className="w-full rounded-2xl py-4 font-black bg-indigo-600" onClick={handleSelectKey}>Kết nối API Key trả phí</Button>
              <Button variant="secondary" className="w-full rounded-2xl py-4 font-black" onClick={() => setErrorMessage(null)}>Bỏ qua</Button>
            </div>
            <p className="mt-6 text-[10px] text-center text-gray-400">
              Bạn cần chọn một API Key từ tài khoản Google Cloud có bật <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-indigo-600 underline">Thanh toán (Billing)</a>.
            </p>
          </div>
        </div>
      )}

      {editingState && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-xl bg-black/40 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-8 duration-500">
            <div className="p-8 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-xl font-black text-gray-900">AI Fine-tuning</h3>
              <button onClick={() => setEditingState(null)} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-8 space-y-8">
              <div className="aspect-video bg-gray-50 rounded-3xl overflow-hidden border border-gray-100 relative group">
                <img src={editingState.imageUrl} className="w-full h-full object-contain" />
                {editingState.isProcessing && (
                  <div className="absolute inset-0 bg-white/80 backdrop-blur-md flex flex-col items-center justify-center animate-pulse">
                    <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <span className="text-xs font-black text-indigo-600 uppercase tracking-widest">Re-rendering...</span>
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Edit Instructions</label>
                <textarea 
                  className="w-full bg-gray-50 border-none rounded-2xl p-6 text-sm font-medium focus:ring-2 focus:ring-indigo-600 transition-all min-h-[120px] resize-none"
                  placeholder="e.g., 'Change the floor to dark walnut wood', 'Add more sunlight from the left'..."
                  value={editingState.prompt}
                  onChange={(e) => setEditingState(prev => prev ? { ...prev, prompt: e.target.value } : null)}
                  disabled={editingState.isProcessing}
                />
              </div>
              <div className="flex space-x-4">
                <Button variant="secondary" size="lg" className="flex-1 rounded-2xl font-black" onClick={() => setEditingState(null)} disabled={editingState.isProcessing}>Cancel</Button>
                <Button variant="primary" size="lg" className="flex-1 rounded-2xl font-black shadow-xl shadow-indigo-100" onClick={handleApplyEdit} isLoading={editingState.isProcessing}>Regenerate</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="flex-grow max-w-7xl mx-auto w-full px-6 py-10">
        {!collection ? (
          <div className="text-center py-32 bg-white rounded-[40px] border border-gray-100 shadow-2xl mt-10 relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
            <div className="w-28 h-28 bg-indigo-50 rounded-[35px] flex items-center justify-center mx-auto mb-10 shadow-inner relative z-10">
              <svg className="w-14 h-14 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h2 className="text-5xl font-black mb-6 text-gray-900 tracking-tight relative z-10 uppercase">Consistency <span className="text-indigo-600">Pro</span></h2>
            <p className="text-gray-400 max-w-xl mx-auto mb-12 text-xl font-medium relative z-10 leading-relaxed">Bộ giải pháp Render CGI chuyên nghiệp dành cho Catalog sản phẩm và phối cảnh nội thất từ bất kỳ bức ảnh chụp điện thoại nào.</p>
            <Button onClick={handleCreateCollection} size="lg" className="rounded-2xl px-12 py-5 text-lg font-black shadow-2xl shadow-indigo-200 relative z-10">Tạo dự án mới</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-12">
            <aside className="lg:col-span-1 space-y-8">
              <div className="bg-white p-8 rounded-[32px] shadow-sm border border-gray-100 sticky top-28">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xs font-black uppercase text-indigo-600 tracking-widest">Environment</h3>
                </div>
                
                <div className="space-y-6">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase mb-3 block tracking-wider">Mood Board (Reference)</label>
                    <div 
                      onClick={() => moodBoardRef.current?.click()}
                      className="w-full aspect-video bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center cursor-pointer hover:bg-indigo-50 hover:border-indigo-200 transition-all overflow-hidden relative group"
                    >
                      {collection.referenceImage ? (
                        <>
                          <img src={collection.referenceImage} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <span className="text-white text-[10px] font-bold uppercase tracking-widest">Change</span>
                          </div>
                          <button 
                            onClick={handleRemoveMoodBoard}
                            className="absolute top-2 right-2 w-7 h-7 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-110 z-20"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </>
                      ) : (
                        <>
                          <svg className="w-8 h-8 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                          <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest text-center px-4">Upload Concept</span>
                        </>
                      )}
                    </div>
                    <input type="file" ref={moodBoardRef} className="hidden" onChange={handleMoodBoardUpload} accept="image/*" />
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase mb-3 block tracking-wider">Light Theme</label>
                    <select className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-black shadow-sm focus:ring-2 focus:ring-indigo-600 transition-all appearance-none" value={collection.mode === 'Individual' ? collection.parameters.lightingEnv : collection.stagingParameters.lightingEnv} onChange={(e) => handleUpdateParams('lightingEnv', e.target.value)}>
                      {Object.values(LightingEnvironment).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase mb-3 block tracking-wider">Room Scene</label>
                    <select className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-black shadow-sm focus:ring-2 focus:ring-indigo-600 transition-all appearance-none" value={collection.mode === 'Individual' ? collection.parameters.roomType : collection.stagingParameters.roomType} onChange={(e) => handleUpdateParams('roomType', e.target.value)}>
                      {Object.values(RoomType).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase mb-3 block tracking-wider">Design Philosophy</label>
                    <select className="w-full bg-gray-50 border-none rounded-2xl p-4 text-sm font-black shadow-sm focus:ring-2 focus:ring-indigo-600 transition-all appearance-none" value={collection.mode === 'Individual' ? collection.parameters.designStyle : collection.stagingParameters.designStyle} onChange={(e) => handleUpdateParams('designStyle', e.target.value)}>
                      {Object.values(DesignStyle).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  
                  {collection.mode === 'Staging' && (
                    <div className="pt-8 border-t border-gray-100">
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-5 block tracking-wider">Camera Positions</label>
                      <div className="grid grid-cols-1 gap-3">
                        {Object.values(CameraAngle).map(angle => (
                          <button
                            key={angle}
                            onClick={() => toggleViewpoint(angle)}
                            className={`flex items-center px-4 py-3.5 rounded-2xl text-[10px] font-black transition-all border-2 ${
                              collection.stagingParameters.viewpoints.includes(angle)
                                ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg'
                                : 'bg-white border-gray-50 text-gray-500 hover:border-indigo-100'
                            }`}
                          >
                            {angle}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </aside>

            <div className="lg:col-span-3 space-y-12">
              <section>
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center space-x-4">
                    <h3 className="text-2xl font-black text-gray-900">Input Materials</h3>
                    <span className="bg-gray-200 text-gray-600 text-[10px] font-black px-3 py-1 rounded-full uppercase">{collection.images.length} Units</span>
                  </div>
                  <div className="flex space-x-3">
                    <Button variant="secondary" size="sm" className="rounded-xl px-5 font-black" onClick={() => fileInputRef.current?.click()}>+ Add Objects</Button>
                    <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleAddImages} />
                    <Button variant="secondary" size="sm" className="rounded-xl px-5 font-black border-indigo-600 text-indigo-600" onClick={() => setCollection({...collection, isConfirmed: true, images: collection.images.map(i => ({...i, inputStatus: InputStatus.CONFIRMED}))})}>Confirm Selection</Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-6">
                  {collection.images.map(img => (
                    <div 
                      key={img.id} 
                      className={`group relative aspect-square bg-white rounded-3xl border-2 transition-all cursor-pointer overflow-hidden ${img.isSelected ? 'border-indigo-600 ring-4 ring-indigo-50 shadow-2xl scale-95' : 'border-gray-50 hover:border-indigo-100'}`}
                      onClick={() => toggleImageSelection(img.id)}
                    >
                      <img src={img.renderedUrl || img.originalUrl} className="w-full h-full object-contain p-6" />
                      {img.renderStatus === 'processing' && (
                        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center">
                          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-2"></div>
                        </div>
                      )}
                      {img.renderedUrl && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingState({ type: 'product', id: img.id, imageUrl: img.renderedUrl!, prompt: '', isProcessing: false });
                          }}
                          className="absolute bottom-3 right-3 w-8 h-8 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {collection.stagedScenes.length > 0 && (
                <section className="animate-in fade-in slide-in-from-bottom-12 duration-1000">
                  <div className="flex items-center space-x-6 mb-10">
                    <h3 className="text-3xl font-black text-gray-900 uppercase">CGI Result <span className="text-indigo-600">Stack</span></h3>
                    <div className="h-1 bg-gray-100 flex-grow rounded-full overflow-hidden">
                       <div className="h-full bg-indigo-600 transition-all duration-1000" style={{ width: `${(collection.stagedScenes.filter(s => s.status === 'completed').length / collection.stagedScenes.length) * 100}%` }}></div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    {collection.stagedScenes.map((scene, index) => (
                      <div key={scene.id} className="bg-white rounded-[48px] border border-gray-100 overflow-hidden shadow-sm hover:shadow-3xl transition-all group">
                        <div className="aspect-video bg-gray-100 relative overflow-hidden">
                          {scene.renderedUrl ? (
                            <img src={scene.renderedUrl} className="w-full h-full object-cover transition-transform duration-[1500ms] group-hover:scale-105" />
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50">
                              {scene.status === 'processing' ? (
                                <div className="flex flex-col items-center space-y-4">
                                  <div className="w-16 h-16 border-[6px] border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
                                  <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">{scene.angle} Render...</span>
                                </div>
                              ) : (
                                <span className="text-[10px] font-black text-gray-300 uppercase">Waiting in Queue</span>
                              )}
                            </div>
                          )}
                          <div className="absolute top-6 left-6 flex space-x-3">
                            <span className="px-5 py-2.5 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase shadow-lg">
                              {index === 0 ? 'Master Reference' : 'Perspective Shift'}
                            </span>
                            <span className="px-5 py-2.5 bg-black/50 backdrop-blur text-white rounded-2xl text-[10px] font-black uppercase">{scene.angle}</span>
                          </div>
                        </div>
                        <div className="p-8 flex items-center justify-between">
                          <div className="flex -space-x-3">
                            {scene.productIds.slice(0, 3).map(pid => {
                              const p = collection.images.find(img => img.id === pid);
                              return p ? <img key={pid} src={p.originalUrl} className="w-10 h-10 rounded-xl border-2 border-white bg-gray-50 object-contain shadow-sm" /> : null;
                            })}
                          </div>
                          {scene.renderedUrl && (
                            <div className="flex space-x-3">
                               <button 
                                onClick={() => setEditingState({ type: 'scene', id: scene.id, imageUrl: scene.renderedUrl!, prompt: '', isProcessing: false })}
                                className="p-3.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-2xl transition-all"
                               >
                                 <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                               </button>
                               <Button variant="primary" size="md" className="rounded-2xl shadow-xl font-black px-10" onClick={() => window.open(scene.renderedUrl)}>Download 4K</Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </main>
      
      <footer className="bg-white border-t border-gray-100 py-16 mt-20">
        <div className="max-w-7xl mx-auto px-6 text-center text-gray-400 text-sm font-medium">
          <p>© 2025 Lem Studio AI - Professional Visualization Engine</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
