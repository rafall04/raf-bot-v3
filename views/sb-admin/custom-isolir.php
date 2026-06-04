<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="description" content="RAF BOT - Custom Isolir">
    <title>RAF BOT - Custom Isolir</title>
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/admin-theme.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/css/isolir-workspace.css" rel="stylesheet">
    <style>
        body.isolir-page { background: #f8fafc; }
        .isolir-header { background: linear-gradient(135deg, #991b1b 0%, #dc2626 58%, #f97316 100%); }
        .isolir-card.accent-card { border-color: #fecaca; box-shadow: 0 16px 36px rgba(185, 28, 28, .08); }
        .candidate-item.selected { border-color: #dc2626; background: #fef2f2; }
        .candidate-item.selected::after { color: #b91c1c; }
        .result-filter .btn.active { background: #dc2626; border-color: #dc2626; color: #fff; }
    </style>
</head>
<body id="page-top" class="isolir-page">
<div id="wrapper">
    <?php include __DIR__ . '/_navbar.php'; ?>
    <div id="content-wrapper" class="d-flex flex-column">
        <div id="content">
            <?php include __DIR__ . '/topbar.php'; ?>
            <div class="container-fluid">
                <div class="isolir-shell">
                    <div class="isolir-header">
                        <h1><i class="fas fa-user-lock mr-2"></i>Custom Isolir</h1>
                        <p>Workspace batch isolir manual untuk operator: pilih kandidat, cek capability reboot, lalu eksekusi tanpa kehilangan konteks selection lintas halaman.</p>
                        <div class="isolir-header-actions">
                            <span class="isolir-header-chip"><i class="fas fa-layer-group"></i>Selection global lintas halaman</span>
                            <span class="isolir-header-chip"><i class="fas fa-history"></i>Audit trail siap telusur</span>
                            <span class="isolir-header-chip"><i class="fas fa-wifi"></i>Reboot tetap opsional</span>
                        </div>
                    </div>
                    <div class="isolir-grid">
                        <div class="isolir-main">
                            <div class="isolir-card">
                                <div class="card-body">
                                    <div class="isolir-section-head">
                                        <div>
                                            <h6>Workspace Kandidat</h6>
                                            <p>Filter, pilih, dan tinjau pelanggan yang akan diisolir sebelum aksi dijalankan.</p>
                                        </div>
                                    </div>
                                    <div class="isolir-toolbar">
                                        <div class="isolir-toolbar-row is-three">
                                            <input class="form-control" id="candidateSearch" placeholder="Cari nama, PPPoE, paket, atau profile">
                                            <select class="form-control" id="subscriptionFilter"><option value="">Semua paket</option></select>
                                            <select class="form-control" id="stateFilter"><option value="">Semua status</option><option value="isolated">Sudah terisolir</option><option value="active">Masih aktif</option></select>
                                        </div>
                                        <div class="isolir-toolbar-row is-two">
                                            <small class="text-muted" id="filterSummary">Belum ada data kandidat.</small>
                                            <div class="isolir-toolbar-actions">
                                                <button class="btn btn-outline-danger" id="refreshCandidatesBtn" type="button"><i class="fas fa-sync-alt mr-1"></i>Refresh</button>
                                                <button class="btn btn-outline-secondary" id="selectCurrentPageBtn" type="button">Pilih Halaman Ini</button>
                                                <button class="btn btn-outline-secondary" id="clearSelectionBtn" type="button">Clear</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="isolir-list" id="candidateGrid"><div class="isolir-empty">Memuat kandidat isolir...</div></div>
                                    <div class="isolir-page-controls mt-3">
                                        <small class="text-muted" id="candidatePageInfo">Halaman 1 / 1</small>
                                        <div class="btn-group btn-group-sm">
                                            <button class="btn btn-outline-secondary" id="candidatePrevPageBtn" type="button">Prev</button>
                                            <button class="btn btn-outline-secondary" id="candidateNextPageBtn" type="button">Next</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="isolir-card">
                                <div class="card-body">
                                    <div class="isolir-section-head">
                                        <div>
                                            <h6>Hasil Eksekusi Terakhir</h6>
                                            <p>Gunakan filter ini untuk audit cepat dan retry pelanggan yang gagal.</p>
                                        </div>
                                        <div class="isolir-inline-actions">
                                            <button class="btn btn-sm btn-outline-danger" id="selectFailedOnlyBtn" type="button">Pilih Failed Only</button>
                                        </div>
                                    </div>
                                    <div class="isolir-result-filters mb-3 result-filter">
                                        <button class="btn btn-outline-secondary active" id="executionFilterAllBtn" type="button">Semua</button>
                                        <button class="btn btn-outline-secondary" id="executionFilterSuccessBtn" type="button">Sukses</button>
                                        <button class="btn btn-outline-secondary" id="executionFilterFailedBtn" type="button">Gagal</button>
                                        <button class="btn btn-outline-secondary" id="executionFilterRebootSkippedBtn" type="button">Reboot Skip</button>
                                    </div>
                                    <div id="lastExecutionResult" class="text-muted">Belum ada eksekusi pada sesi ini.</div>
                                </div>
                            </div>
                        </div>
                        <div class="isolir-sidebar">
                            <div class="isolir-sticky">
                                <div class="isolir-panel-stack">
                                    <div class="isolir-card accent-card">
                                        <div class="card-body">
                                            <div class="isolir-section-head">
                                                <div>
                                                    <h6>Tindakan Manual</h6>
                                                    <p>Setel profile target, catatan operasional, dan opsi disconnect atau reboot.</p>
                                                </div>
                                            </div>
                                            <div class="form-group"><label for="targetProfile">Target Profile</label><select class="form-control" id="targetProfile"></select></div>
                                            <div class="form-group"><label for="isolirReason">Alasan / Catatan</label><textarea class="form-control" id="isolirReason" rows="4" placeholder="Contoh: isolir manual karena override operasional"></textarea></div>
                                            <div class="isolir-switches mb-3">
                                                <div class="custom-control custom-switch"><input type="checkbox" class="custom-control-input" id="disconnectFlag"><label class="custom-control-label" for="disconnectFlag">Disconnect active session</label></div>
                                                <div class="custom-control custom-switch"><input type="checkbox" class="custom-control-input" id="rebootFlag"><label class="custom-control-label" for="rebootFlag">Reboot router jika capability tersedia</label></div>
                                            </div>
                                            <div class="isolir-summary-box mb-3" id="genieacsNotice">Status capability GenieACS sedang dimuat...</div>
                                            <div class="isolir-summary-box mb-3" id="selectionSummary">Belum ada pelanggan dipilih.</div>
                                            <button class="btn btn-danger btn-block" id="runIsolirBtn" disabled type="button"><i class="fas fa-user-lock mr-2"></i>Jalankan Custom Isolir</button>
                                        </div>
                                    </div>
                                    <div class="isolir-card">
                                        <div class="card-body">
                                            <div class="isolir-section-head">
                                                <div>
                                                    <h6>Riwayat Isolir</h6>
                                                    <p>Lacak manual isolir dan buka isolir dari audit store yang sama.</p>
                                                </div>
                                                <div class="isolir-inline-actions">
                                                    <select class="form-control form-control-sm" id="historyFilter">
                                                        <option value="all">Semua aksi</option>
                                                        <option value="manual_isolir">Manual isolir</option>
                                                        <option value="open_isolir">Buka isolir</option>
                                                    </select>
                                                    <button class="btn btn-sm btn-outline-secondary" id="refreshHistoryBtn" type="button">Refresh</button>
                                                </div>
                                            </div>
                                            <div class="isolir-table-wrap"><table class="table table-sm isolir-table history-table mb-0"><thead><tr><th>Waktu</th><th>Aksi</th><th>Actor</th><th>Ringkasan</th><th>Detail</th></tr></thead><tbody id="historyBody"><tr><td colspan="5" class="text-center text-muted py-3">Memuat riwayat...</td></tr></tbody></table></div>
                                            <div class="isolir-page-controls mt-3"><small class="text-muted" id="historyPageInfo">Halaman 1 / 1</small><div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary" id="historyPrevPageBtn" type="button">Prev</button><button class="btn btn-outline-secondary" id="historyNextPageBtn" type="button">Next</button></div></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <?php include __DIR__ . '/footer.php'; ?>
    </div>
</div>
<script src="/vendor/jquery/jquery.min.js"></script>
<script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
<script src="/js/sb-admin-2.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
<script>
const state={visibleItems:[],selectedItems:new Map(),policy:null,availableProfiles:[],availableSubscriptions:[],genieacsStatus:null,currentSearch:'',currentSubscription:'',currentStateFilter:'',candidateSummary:null,candidatePagination:{page:1,limit:20,totalPages:1,totalItems:0},historyFilter:'all',historyPagination:{page:1,limit:15,totalPages:1,totalItems:0},lastExecution:null,executionFilter:'all',hasInitializedPolicyDefaults:false,userTouchedTargetProfile:false,userTouchedDisconnect:false,userTouchedReboot:false};
document.addEventListener('DOMContentLoaded',()=>{bindEvents();loadCandidates();loadHistory();loadGenieacsStatus();});
function bindEvents(){document.getElementById('refreshCandidatesBtn').addEventListener('click',loadCandidates);document.getElementById('refreshHistoryBtn').addEventListener('click',loadHistory);document.getElementById('selectCurrentPageBtn').addEventListener('click',selectCurrentPage);document.getElementById('clearSelectionBtn').addEventListener('click',clearSelection);document.getElementById('runIsolirBtn').addEventListener('click',submitManualIsolir);document.getElementById('subscriptionFilter').addEventListener('change',()=>{state.currentSubscription=document.getElementById('subscriptionFilter').value;state.candidatePagination.page=1;loadCandidates();});document.getElementById('stateFilter').addEventListener('change',()=>{state.currentStateFilter=document.getElementById('stateFilter').value;state.candidatePagination.page=1;loadCandidates();});document.getElementById('historyFilter').addEventListener('change',()=>{state.historyFilter=document.getElementById('historyFilter').value;state.historyPagination.page=1;loadHistory();});document.getElementById('candidatePrevPageBtn').addEventListener('click',()=>changeCandidatePage(-1));document.getElementById('candidateNextPageBtn').addEventListener('click',()=>changeCandidatePage(1));document.getElementById('historyPrevPageBtn').addEventListener('click',()=>changeHistoryPage(-1));document.getElementById('historyNextPageBtn').addEventListener('click',()=>changeHistoryPage(1));document.getElementById('targetProfile').addEventListener('change',()=>{state.userTouchedTargetProfile=true;updateSummary();});document.getElementById('disconnectFlag').addEventListener('change',()=>{state.userTouchedDisconnect=true;updateSummary();});document.getElementById('rebootFlag').addEventListener('change',()=>{state.userTouchedReboot=true;updateSummary();});document.getElementById('executionFilterAllBtn').addEventListener('click',()=>setExecutionFilter('all'));document.getElementById('executionFilterSuccessBtn').addEventListener('click',()=>setExecutionFilter('success'));document.getElementById('executionFilterFailedBtn').addEventListener('click',()=>setExecutionFilter('failed'));document.getElementById('executionFilterRebootSkippedBtn').addEventListener('click',()=>setExecutionFilter('rebootSkipped'));document.getElementById('selectFailedOnlyBtn').addEventListener('click',selectFailedOnlyFromLastExecution);document.getElementById('candidateSearch').addEventListener('input',debounce(()=>{state.currentSearch=document.getElementById('candidateSearch').value.trim();state.candidatePagination.page=1;loadCandidates();},250));}
function debounce(callback,delay){let timer=null;return(...args)=>{window.clearTimeout(timer);timer=window.setTimeout(()=>callback(...args),delay);};}
function getSelectedRecords(){return Array.from(state.selectedItems.values());}
function getVisibleSelectedCount(){return state.visibleItems.filter((item)=>state.selectedItems.has(item.id)).length;}
function getGlobalSelectedCount(){return state.selectedItems.size;}
function indexVisibleItems(){for(const item of state.visibleItems){if(state.selectedItems.has(item.id)){state.selectedItems.set(item.id,item);}}}
function pruneSelectionAgainstLatestData(){if(!state.lastExecution||!Array.isArray(state.lastExecution.results))return;const validIds=new Set([...Array.from(state.selectedItems.keys()),...state.lastExecution.results.map((item)=>item.userId).filter(Boolean)]);for(const selectedId of Array.from(state.selectedItems.keys())){if(!validIds.has(selectedId)){state.selectedItems.delete(selectedId);}}}
function hydrateSubscriptionOptions(){const select=document.getElementById('subscriptionFilter');const previous=state.currentSubscription;select.innerHTML='<option value=\"\">Semua paket</option>'+state.availableSubscriptions.map((subscription)=>`<option value=\"${escapeHtml(subscription)}\">${escapeHtml(subscription)}</option>`).join('');select.value=previous;}
function hydratePolicyDefaults(){const targetProfile=document.getElementById('targetProfile');const disconnectFlag=document.getElementById('disconnectFlag');const rebootFlag=document.getElementById('rebootFlag');const defaultProfile=state.policy?.isolirManualDefaultProfile||'ISOLIR';const options=[...new Set([defaultProfile,...state.availableProfiles].filter(Boolean))];const currentValue=targetProfile.value||defaultProfile;const nextValue=options.includes(currentValue)?currentValue:defaultProfile;targetProfile.innerHTML=options.map((profile)=>`<option value=\"${escapeHtml(profile)}\">${escapeHtml(profile)}</option>`).join('');if(!state.hasInitializedPolicyDefaults){targetProfile.value=nextValue;disconnectFlag.checked=state.policy?.isolirManualDefaultDisconnect!==false;rebootFlag.checked=state.policy?.isolirManualDefaultReboot===true;state.hasInitializedPolicyDefaults=true;return;}targetProfile.value=!state.userTouchedTargetProfile||!options.includes(currentValue)?nextValue:currentValue;if(!state.userTouchedDisconnect){disconnectFlag.checked=state.policy?.isolirManualDefaultDisconnect!==false;}if(!state.userTouchedReboot){rebootFlag.checked=state.policy?.isolirManualDefaultReboot===true;}}
async function loadCandidates(){const grid=document.getElementById('candidateGrid');grid.innerHTML='<div class=\"isolir-empty\">Memuat kandidat isolir...</div>';const params=new URLSearchParams({page:String(state.candidatePagination.page),limit:String(state.candidatePagination.limit)});if(state.currentSearch)params.set('search',state.currentSearch);if(state.currentSubscription)params.set('subscription',state.currentSubscription);if(state.currentStateFilter==='isolated')params.set('isCurrentlyIsolated','true');if(state.currentStateFilter==='active')params.set('isCurrentlyIsolated','false');const response=await fetch(`/api/isolir/candidates?${params.toString()}`,{credentials:'include'});const payload=await response.json();if(!response.ok){grid.innerHTML=`<div class=\"isolir-empty text-danger\">${escapeHtml(payload.message||'Gagal memuat kandidat isolir.')}</div>`;document.getElementById('filterSummary').textContent='Gagal memuat kandidat.';return;}state.visibleItems=payload.data?.items||[];state.candidatePagination=payload.data?.pagination||state.candidatePagination;state.policy=payload.meta?.policy||null;state.availableProfiles=payload.meta?.availableProfiles||[];state.availableSubscriptions=payload.meta?.availableSubscriptions||[];state.candidateSummary=payload.meta?.summary||null;hydratePolicyDefaults();hydrateSubscriptionOptions();indexVisibleItems();pruneSelectionAgainstLatestData();renderCandidates();}
function renderCandidates(){const grid=document.getElementById('candidateGrid');if(!state.visibleItems.length){grid.innerHTML='<div class=\"isolir-empty\">Tidak ada kandidat isolir manual.</div>';updateFilterSummary();updateCandidatePageInfo();updateSummary();applyGenieacsRebootAvailability();return;}grid.innerHTML=state.visibleItems.map((item)=>{const selected=state.selectedItems.has(item.id);const capabilityClass=item.genieacsCapable?'ready':'warn';const capabilityText=item.genieacsCapable?'Reboot siap':(item.genieacsReason||'Reboot tidak tersedia');const statusBadge=item.isCurrentlyIsolated?'<span class=\"isolir-pill danger\"><i class=\"fas fa-ban\"></i>Terisolir</span>':'<span class=\"isolir-pill ready\"><i class=\"fas fa-check\"></i>Aktif</span>';return `<div class=\"isolir-item candidate-item ${selected?'selected':''}\" onclick=\"toggleCandidate(${item.id})\"><div class=\"isolir-item-shell\"><div><div class=\"isolir-item-title\"><input type=\"checkbox\" ${selected?'checked':''} onclick=\"event.stopPropagation();\" onchange=\"toggleCandidate(${item.id})\"> <span>${escapeHtml(item.name||'-')}</span></div><div class=\"isolir-item-meta\"><div><strong>PPPoE</strong> ${escapeHtml(item.pppoe_username||'-')}</div><div><strong>Paket</strong> ${escapeHtml(item.subscription||'-')}</div><div><strong>Profile aktif</strong> <span class=\"isolir-pill profile\">${escapeHtml(item.currentProfile||'N/A')}</span></div></div></div><div class=\"isolir-item-side\">${statusBadge}<span class=\"isolir-pill ${capabilityClass}\">${escapeHtml(capabilityText)}</span></div></div></div>`;}).join('');updateFilterSummary();updateCandidatePageInfo();updateSummary();applyGenieacsRebootAvailability();}
function updateFilterSummary(){const filteredCount=state.candidateSummary?.filteredCount??state.candidatePagination.totalItems??state.visibleItems.length;const isolatedCount=state.candidateSummary?.isolatedCount??state.visibleItems.filter((item)=>item.isCurrentlyIsolated).length;document.getElementById('filterSummary').textContent=`${filteredCount} kandidat cocok, ${isolatedCount} sedang terisolir, ${getGlobalSelectedCount()} dipilih global, ${getVisibleSelectedCount()} tampil di halaman ini.`;}
function updateCandidatePageInfo(){document.getElementById('candidatePageInfo').textContent=`Halaman ${state.candidatePagination.page||1} / ${state.candidatePagination.totalPages||1}`;document.getElementById('candidatePrevPageBtn').disabled=(state.candidatePagination.page||1)<=1;document.getElementById('candidateNextPageBtn').disabled=(state.candidatePagination.page||1)>=(state.candidatePagination.totalPages||1);}
function changeCandidatePage(delta){const nextPage=(state.candidatePagination.page||1)+delta;if(nextPage<1||nextPage>(state.candidatePagination.totalPages||1))return;state.candidatePagination.page=nextPage;loadCandidates();}
function toggleCandidate(candidateId){const visibleRecord=state.visibleItems.find((item)=>item.id===candidateId);if(state.selectedItems.has(candidateId)){state.selectedItems.delete(candidateId);}else if(visibleRecord){state.selectedItems.set(candidateId,visibleRecord);}renderCandidates();}
function selectCurrentPage(){state.visibleItems.forEach((item)=>state.selectedItems.set(item.id,item));renderCandidates();}
function clearSelection(){state.selectedItems.clear();renderCandidates();}
function updateSummary(){const selected=getSelectedRecords();const summary=document.getElementById('selectionSummary');const button=document.getElementById('runIsolirBtn');const targetProfile=document.getElementById('targetProfile').value||(state.policy?.isolirManualDefaultProfile||'ISOLIR');const disconnect=document.getElementById('disconnectFlag').checked;const reboot=!document.getElementById('rebootFlag').disabled&&document.getElementById('rebootFlag').checked;if(!selected.length){summary.textContent='Belum ada pelanggan dipilih.';button.disabled=true;return;}const rebootCapable=selected.filter((item)=>item.genieacsCapable).length;const alreadyIsolated=selected.filter((item)=>item.isCurrentlyIsolated).length;const hiddenCount=selected.length-getVisibleSelectedCount();summary.innerHTML=`<strong>${selected.length}</strong> pelanggan dipilih global.<br>Preview profile: <strong>${escapeHtml(targetProfile)}</strong> untuk ${selected.length} pelanggan.<br>Disconnect: <strong>${disconnect?'Ya':'Tidak'}</strong>.<br>Reboot diminta: <strong>${reboot?'Ya':'Tidak'}</strong>. Estimasi skip reboot: <strong>${reboot?selected.length-rebootCapable:0}</strong>.<br>${alreadyIsolated} sudah sedang terisolir.${hiddenCount>0?`<br>${hiddenCount} selection tidak tampil pada halaman ini.`:''}`;button.disabled=false;}
async function loadHistory(){const body=document.getElementById('historyBody');body.innerHTML='<tr><td colspan=\"5\" class=\"text-center text-muted py-3\">Memuat riwayat...</td></tr>';const params=new URLSearchParams({page:String(state.historyPagination.page),limit:String(state.historyPagination.limit)});if(state.historyFilter!=='all'){params.set('actionType',state.historyFilter);}const response=await fetch(`/api/isolir/history?${params.toString()}`,{credentials:'include'});const payload=await response.json();if(!response.ok||!Array.isArray(payload.data)){body.innerHTML='<tr><td colspan=\"5\" class=\"text-center text-danger py-3\">Gagal memuat riwayat.</td></tr>';return;}state.historyPagination=payload.meta?.pagination||state.historyPagination;if(!payload.data.length){body.innerHTML='<tr><td colspan=\"5\" class=\"text-center text-muted py-3\">Belum ada riwayat.</td></tr>';updateHistoryPageInfo();return;}body.innerHTML=payload.data.map((entry)=>{const summary=entry.summary||{};const profile=entry.targetProfile?` [${entry.targetProfile}]`:'';const reason=entry.reason?` - ${entry.reason}`:'';return `<tr><td data-label=\"Waktu\">${escapeHtml(formatDate(entry.createdAt))}</td><td data-label=\"Aksi\">${escapeHtml((entry.actionType||'-')+profile+reason)}</td><td data-label=\"Actor\">${escapeHtml(entry.actor?.username||'system')}</td><td data-label=\"Ringkasan\">${summary.successCount||0} sukses / ${summary.failedCount||0} gagal / ${summary.rebootSkippedCount||0} reboot skip</td><td data-label=\"Detail\"><button class=\"btn btn-sm btn-outline-primary\" type=\"button\" onclick=\"showHistoryDetail('${escapeHtml(entry.id)}')\">Detail</button></td></tr>`;}).join('');updateHistoryPageInfo();}
function updateHistoryPageInfo(){document.getElementById('historyPageInfo').textContent=`Halaman ${state.historyPagination.page||1} / ${state.historyPagination.totalPages||1}`;document.getElementById('historyPrevPageBtn').disabled=(state.historyPagination.page||1)<=1;document.getElementById('historyNextPageBtn').disabled=(state.historyPagination.page||1)>=(state.historyPagination.totalPages||1);}
function changeHistoryPage(delta){const nextPage=(state.historyPagination.page||1)+delta;if(nextPage<1||nextPage>(state.historyPagination.totalPages||1))return;state.historyPagination.page=nextPage;loadHistory();}
async function loadGenieacsStatus(){const notice=document.getElementById('genieacsNotice');const response=await fetch('/api/genieacs/feature-status',{credentials:'include'});const payload=await response.json();state.genieacsStatus=payload.data||null;if(!response.ok||!state.genieacsStatus){notice.className='alert alert-warning border';notice.textContent='Status GenieACS tidak dapat dimuat. Reboot akan diverifikasi saat eksekusi.';applyGenieacsRebootAvailability();return;}notice.className=state.genieacsStatus.available?'alert alert-success border':'alert alert-warning border';notice.textContent=state.genieacsStatus.reason||'GenieACS tersedia untuk reboot admin.';applyGenieacsRebootAvailability();}
function applyGenieacsRebootAvailability(){const rebootFlag=document.getElementById('rebootFlag');const notice=document.getElementById('genieacsNotice');const selected=getSelectedRecords();const selectedCapable=selected.filter((item)=>item.genieacsCapable).length;const hiddenCount=selected.length-getVisibleSelectedCount();if(state.genieacsStatus&&state.genieacsStatus.available===false){rebootFlag.checked=false;rebootFlag.disabled=true;notice.className='alert alert-warning border';notice.textContent=state.genieacsStatus.reason||'GenieACS tidak tersedia untuk reboot admin.';updateSummary();return;}rebootFlag.disabled=false;if(selected.length>0){const skipped=selected.length-selectedCapable;notice.className=skipped>0?'alert alert-warning border':'alert alert-success border';notice.textContent=skipped>0?`${selectedCapable} pelanggan siap reboot, ${skipped} akan skip reboot karena device/capability tidak tersedia.${hiddenCount>0?` ${hiddenCount} selection tidak tampil pada halaman ini.`:''}`:`Semua pelanggan terpilih siap untuk reboot opsional.${hiddenCount>0?` ${hiddenCount} selection tidak tampil pada halaman ini.`:''}`;}updateSummary();}
async function submitManualIsolir(){const userIds=Array.from(state.selectedItems.keys());const targetProfile=document.getElementById('targetProfile').value;const reason=document.getElementById('isolirReason').value.trim();const disconnect=document.getElementById('disconnectFlag').checked;const reboot=!document.getElementById('rebootFlag').disabled&&document.getElementById('rebootFlag').checked;if(!userIds.length){Swal.fire('Validasi','Pilih minimal satu pelanggan.','warning');return;}if(!reason){Swal.fire('Validasi','Alasan isolir wajib diisi.','warning');return;}const confirm=await Swal.fire({title:'Jalankan Custom Isolir?',html:`<div class=\"text-left\"><div><strong>Pelanggan:</strong> ${userIds.length}</div><div><strong>Target profile:</strong> ${escapeHtml(targetProfile)}</div><div><strong>Disconnect:</strong> ${disconnect?'Ya':'Tidak'}</div><div><strong>Reboot:</strong> ${reboot?'Ya':'Tidak'}</div></div>`,icon:'warning',showCancelButton:true,confirmButtonText:'Jalankan',cancelButtonText:'Batal',confirmButtonColor:'#dc2626'});if(!confirm.isConfirmed)return;Swal.fire({title:'Memproses...',allowOutsideClick:false,didOpen:()=>Swal.showLoading()});const response=await fetch('/api/isolir/manual',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({userIds,targetProfile,disconnect,reboot,reason})});const payload=await response.json();if(!response.ok){Swal.fire('Gagal',payload.message||'Isolir manual gagal dijalankan.','error');return;}state.lastExecution=payload.data||null;renderLastExecution();state.selectedItems.clear();document.getElementById('isolirReason').value='';const summary=payload.data?.summary||{};await Swal.fire('Selesai',`${summary.successCount||0} sukses, ${summary.failedCount||0} gagal, ${summary.rebootSkippedCount||0} reboot skip.`,(summary.successCount||0)>0?'success':'warning');await Promise.all([loadCandidates(),loadHistory()]);}
function setExecutionFilter(filter){state.executionFilter=filter;document.querySelectorAll('.result-filter .btn').forEach((button)=>button.classList.remove('active'));if(filter==='all')document.getElementById('executionFilterAllBtn').classList.add('active');if(filter==='success')document.getElementById('executionFilterSuccessBtn').classList.add('active');if(filter==='failed')document.getElementById('executionFilterFailedBtn').classList.add('active');if(filter==='rebootSkipped')document.getElementById('executionFilterRebootSkippedBtn').classList.add('active');renderLastExecution();}
function selectFailedOnlyFromLastExecution(){state.selectedItems.clear();(state.lastExecution?.results||[]).filter((item)=>item&&!item.ok&&item.userId).forEach((item)=>{state.selectedItems.set(item.userId,{id:item.userId,name:item.name||item.pppoe_username||'-',pppoe_username:item.pppoe_username||'-',subscription:item.subscription||'-',currentProfile:item.currentProfile||null,isCurrentlyIsolated:true,genieacsCapable:item.rebootApplied===true,genieacsReason:item.rebootSkippedReason||null});});renderCandidates();}
function renderLastExecution(){const container=document.getElementById('lastExecutionResult');if(!state.lastExecution){container.textContent='Belum ada eksekusi pada sesi ini.';return;}const summary=state.lastExecution.summary||{};let details=Array.isArray(state.lastExecution.results)?state.lastExecution.results:[];if(state.executionFilter==='success')details=details.filter((item)=>item.ok);if(state.executionFilter==='failed')details=details.filter((item)=>!item.ok);if(state.executionFilter==='rebootSkipped')details=details.filter((item)=>item.rebootRequested&&!item.rebootApplied);container.innerHTML=`<div class=\"isolir-result-summary\"><span class=\"isolir-result-chip\">${summary.successCount||0} sukses</span><span class=\"isolir-result-chip\">${summary.failedCount||0} gagal</span><span class=\"isolir-result-chip\">${summary.rebootSkippedCount||0} reboot skip</span>${state.lastExecution.historyId?`<button type=\"button\" class=\"btn btn-link btn-sm p-0 align-baseline\" onclick=\"showHistoryDetail('${escapeHtml(state.lastExecution.historyId)}')\">Lihat audit</button>`:''}</div><div class=\"isolir-table-wrap\"><table class=\"table table-sm isolir-table mb-0\"><thead><tr><th>Pelanggan</th><th>Status</th><th>Disconnect</th><th>Reboot</th></tr></thead><tbody>${details.length?details.map((item)=>`<tr><td data-label=\"Pelanggan\">${escapeHtml(item.name||item.pppoe_username||'-')}</td><td data-label=\"Status\">${escapeHtml(item.ok?'Sukses':(item.message||'Gagal'))}</td><td data-label=\"Disconnect\">${escapeHtml(item.disconnectApplied?'Applied':(item.disconnectRequested?(item.disconnectNote||'Skipped'):'No'))}</td><td data-label=\"Reboot\">${escapeHtml(item.rebootApplied?'Applied':(item.rebootSkippedReason||(item.rebootRequested?'Skipped':'No')))}</td></tr>`).join(''):'<tr><td colspan=\"4\" class=\"text-center text-muted\">Tidak ada hasil untuk filter ini.</td></tr>'}</tbody></table></div>`;}
async function showHistoryDetail(historyId){const response=await fetch(`/api/isolir/history/${encodeURIComponent(historyId)}`,{credentials:'include'});const payload=await response.json();if(!response.ok||!payload.data){Swal.fire('Gagal',payload.message||'Detail riwayat tidak dapat dimuat.','error');return;}const entry=payload.data;const results=Array.isArray(entry.results)?entry.results:[];await Swal.fire({title:'Detail Riwayat Isolir',width:920,html:`<div class=\"text-left mb-3\"><div><strong>Aksi:</strong> ${escapeHtml(entry.actionType||'-')}</div><div><strong>Waktu:</strong> ${escapeHtml(formatDate(entry.createdAt))}</div><div><strong>Actor:</strong> ${escapeHtml(entry.actor?.username||'system')}</div><div><strong>Reason:</strong> ${escapeHtml(entry.reason||'-')}</div></div><div class=\"table-responsive text-left\"><table class=\"table table-sm mb-0\"><thead><tr><th>Pelanggan</th><th>Status</th><th>Disconnect</th><th>Reboot</th></tr></thead><tbody>${results.map((item)=>`<tr><td>${escapeHtml(item.name||item.pppoe_username||'-')}</td><td>${escapeHtml(item.ok?'Sukses':(item.message||'Gagal'))}</td><td>${escapeHtml(item.disconnectApplied?'Applied':(item.disconnectRequested?(item.disconnectNote||'Skipped'):'No'))}</td><td>${escapeHtml(item.rebootApplied?'Applied':(item.rebootSkippedReason||(item.rebootRequested?'Skipped':'No')))}</td></tr>`).join('')}</tbody></table></div>`});}
function formatDate(value){if(!value)return'-';const date=new Date(value);return Number.isNaN(date.getTime())?'-':date.toLocaleString('id-ID');}
function escapeHtml(value){return String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');}
window.toggleCandidate=toggleCandidate;window.showHistoryDetail=showHistoryDetail;
</script>
</body>
</html>
