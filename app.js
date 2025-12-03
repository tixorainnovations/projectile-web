/* ====== CONFIG ====== */
const API_BASE = 'https://script.google.com/macros/s/AKfycbyu2KMl7vtHewogPk7jmyUb3lE0NtP2abXSfqpHaExdZ37KhT6MiQ9mTZsjFFuLdWT1/exec';
const WRITE_TOKEN = 'Projectile_55310';

const WHATSAPP_COUNTRY_CODE = '91';
const WHATSAPP_NUMBER = '9496055310';

/* ===== UTIL ===== */
const $ = id => document.getElementById(id);

function validMobile(v){
  return /^[6-9]\d{9}$/.test((v || '').trim());
}

function escapeHtml(s){
  return (s || '').toString().replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
  );
}

/* ============= GLOBAL STATE ============= */
let currentCourse = '';
let currentTopics = [];        // full result from backend
let filteredTopics = null;     // filtered (by college/location) list
let currentPage = 0;
const PAGE_SIZE = 10;

let filterMode = "";           // "college" | "location"
let filterOptions = [];        // (not mandatory but ok to keep)
let filterData = {             // holds unique lists
  college: [],
  location: []
};

let initialLeadSavedFor = {};  // avoid duplicate initial leads
let pendingSelection = null;

/* ============= API HELPERS ============= */
async function apiGet(params){
  const url = API_BASE + '?' + new URLSearchParams(params).toString();
  const res = await fetch(url);
  return res.json();
}

async function apiPost(payload){
  const body = new URLSearchParams();
  for (const k in payload){
    body.append(k, payload[k] == null ? '' : payload[k]);
  }
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: body.toString()
  });
  const txt = await res.text();
  try { return JSON.parse(txt); }
  catch { return { success:false, error:'Invalid JSON', raw:txt }; }
}

/* ============= TOAST ============= */
function toast(msg, type='info'){
  const wrap = $('toasts');
  if (!wrap) return;

  const t = document.createElement('div');
  t.className = 'toast ' + (type === 'success' ? 'success' : type === 'error' ? 'error' : '');
  t.textContent = msg;
  wrap.appendChild(t);

  setTimeout(() => {
    t.style.opacity = '0';
    t.addEventListener('transitionend', () => t.remove());
  }, 2500);
}

/* ============= MODAL ============= */
let _modalOkHandler = null;

function showModal(title, text, onOk){
  const titleEl = $('modalTitle');
  const textEl = $('modalText');
  const backdrop = $('modalBackdrop');

  if(!titleEl || !textEl || !backdrop) return;

  titleEl.textContent = title;
  textEl.textContent = text;
  backdrop.style.display = 'flex';
  setTimeout(() => backdrop.classList.add('show'), 10);

  if(_modalOkHandler){
    $('modalOk').removeEventListener('click', _modalOkHandler);
  }

  _modalOkHandler = () => { hideModal(); onOk && onOk(); };
  $('modalOk').addEventListener('click', _modalOkHandler);

  // reset Cancel button safely
  const oldCancel = $('modalCancel');
  if (oldCancel){
    const newCancel = oldCancel.cloneNode(true);
    oldCancel.parentNode.replaceChild(newCancel, oldCancel);
    newCancel.addEventListener('click', hideModal);
  }
}

function hideModal(){
  const backdrop = $('modalBackdrop');
  if(!backdrop) return;
  backdrop.classList.remove('show');
  setTimeout(() => { backdrop.style.display = 'none'; }, 150);
}

/* ============= NAVIGATION ============= */
function goto(page){
  ['home','entry','courses','topics','done'].forEach(p => {
    const el = $('page-' + p);
    if(el) el.style.display = (p === page ? 'block' : 'none');
  });

  if(page === 'courses') loadCourses();
  if(page === 'topics'){
    if(currentCourse) loadTopics(currentCourse);
    else goto('courses');
  }
}
// expose for inline onclick=""
window.goto = goto;

/* ============= ACTIVE LIST HELPER ============= */
// returns whichever list we are currently using (filtered or full)
function getActiveList(){
  return filteredTopics || currentTopics;
}

/* ============= LOAD COURSES ============= */
async function loadCourses(){
  const sel = $('courseSelect');
  if(!sel) return;

  sel.innerHTML = '<option>Loading...</option>';
  try {
    const r = await apiGet({ action:'getCourses' });
    if(r.success && r.data && r.data.length){
      sel.innerHTML = '<option value="">Select course</option>';
      r.data.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        sel.appendChild(opt);
      });
    } else {
      sel.innerHTML = '<option>No courses available</option>';
    }
  } catch(err){
    console.error(err);
    sel.innerHTML = '<option>Error loading</option>';
    toast('Failed to load courses', 'error');
  }
}

/* ============= LOAD TOPICS ============= */
async function loadTopics(course){
  currentCourse = course;
  const selCourse = $('selCourse');
  if(selCourse) selCourse.textContent = 'Course: ' + course;

  const wrap = $('topicsWrap');
  const noTopics = $('noTopics');
  const loader = $('loader');
  const loadMoreContainer = $('loadMoreContainer');

  if(wrap) wrap.innerHTML = '';
  if(noTopics) noTopics.style.display = 'none';
  if(loader) loader.style.display = 'inline-block';
  if(loadMoreContainer) loadMoreContainer.style.display = 'none';

  currentTopics = [];
  filteredTopics = null;
  filterMode = '';
  filterData = { college: [], location: [] };
  currentPage = 0;

  try {
    const r = await apiGet({ action:'getTopics', course });
    if(loader) loader.style.display = 'none';

    if(r.success && r.data && r.data.length){
      currentTopics = r.data;
      extractFilterOptions();
      renderTopicsPage(true);
    } else {
      currentTopics = [];
      if(noTopics) noTopics.style.display = 'block';
    }
  } catch(err){
    console.error(err);
    currentTopics = [];
    if(loader) loader.style.display = 'none';
    if(noTopics) noTopics.style.display = 'block';
    toast('Error loading topics', 'error');
  }
}

/* ============= FILTER OPTIONS ============= */
function extractFilterOptions(){
  const list = currentTopics;
  const colleges = new Set();
  const locations = new Set();

  list.forEach(row => {
    if (row.college)  colleges.add(row.college);
    if (row.location) locations.add(row.location);
  });

  filterData = {
    college: Array.from(colleges),
    location: Array.from(locations)
  };

  console.log('filterData:', filterData);
}

/* ============= PAGINATION ============= */
function renderTopicsPage(reset=false){
  const wrap = $('topicsWrap');
  const noTopics = $('noTopics');
  const loadMoreContainer = $('loadMoreContainer');
  if(!wrap) return;

  if(reset){
    wrap.innerHTML = '';
    currentPage = 0;
  }

  const list = getActiveList();
  if(!list || !list.length){
    if(loadMoreContainer) loadMoreContainer.style.display = 'none';
    if(noTopics) noTopics.style.display = 'block';
    return;
  }

  if(noTopics) noTopics.style.display = 'none';

  const start = currentPage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, list.length);

  for(let i = start; i < end; i++){
    const t = list[i];
    const div = document.createElement('div');
    div.className = 'topic';

    const title = t.title || t.topic || '(no title)';
    const brief = (t.brief || t.description || '').slice(0, 220);

    div.innerHTML = `
      <div>
        <h4>${escapeHtml(title)}</h4>
        <p class="info">${escapeHtml(brief.slice(0,120))}${brief.length>120 ? '…' : ''}</p>
        <div class="meta small">Method: ${escapeHtml(t.method || '')}</div>
      </div>
      <div class="row-btns">
        <button class="btn btn-sm btn-select" data-index="${i}">Select</button>
        <button class="btn btn-sm ghost btn-more" data-index="${i}">Get Details</button>
      </div>
    `;

    wrap.appendChild(div);
  }

  currentPage++;

  if(loadMoreContainer){
    loadMoreContainer.style.display =
      (end < list.length ? 'block' : 'none');
  }
}

/* ============= FILTER UI HELPERS ============= */
function fillDropdown(){
  const box = $('filterBox');
  const dd  = $('filterDropdown');
  const lab = $('filterLabel');

  if(!box || !dd || !lab) return;

  box.style.display = 'block';
  dd.innerHTML = '';

  if (filterMode === 'college') {
    lab.textContent = 'Select College:';
    filterData.college.forEach(x => {
      const opt = document.createElement('option');
      opt.value = x;
      opt.textContent = x;
      dd.appendChild(opt);
    });
  }

  if (filterMode === 'location') {
    lab.textContent = 'Select Location:';
    filterData.location.forEach(x => {
      const opt = document.createElement('option');
      opt.value = x;
      opt.textContent = x;
      dd.appendChild(opt);
    });
  }
}

// called when “Search by College / Location” buttons are clicked
function showFilterBox(mode){
  filterMode = mode;           // 'college' or 'location'
  if(!filterData || (!filterData.college.length && !filterData.location.length)){
    toast('No filter data found for this course', 'error');
    return;
  }
  fillDropdown();
}

/* ============= TOPIC BUTTON HANDLER ============= */
function topicsClickHandler(ev){
  const list = getActiveList();
  const selBtn = ev.target.closest('.btn-select');
  const moreBtn = ev.target.closest('.btn-more');

  // SELECT → save lead
  if(selBtn){
    const idx = Number(selBtn.dataset.index);
    const topic = list[idx];
    if(!topic){ toast('Topic not found', 'error'); return; }

    const mobile = $('mobile')?.value || '';
    const college = $('college')?.value || '';
    if(!validMobile(mobile) || !college.trim()){
      toast('Enter your mobile & college first', 'error');
      goto('entry');
      return;
    }

    showModal('Confirm this topic?', topic.title || topic.topic || '(no title)', () => {
      selectTopic(topic);
    });
    return;
  }

  // GET DETAILS → WhatsApp
  if(moreBtn){
    const idx = Number(moreBtn.dataset.index);
    const topic = list[idx];
    if(!topic) return;

    const mobile = $('mobile')?.value.trim() || '';
    const college = $('college')?.value.trim() || '';
    const name = $('name')?.value.trim() || '';
    const course = currentCourse || ($('courseSelect')?.value || '');

    if(!validMobile(mobile) || !college){
      toast('Enter your mobile & college first', 'error');
      goto('entry');
      return;
    }

    const title = topic.title || topic.topic || '(no title)';
    const msg =
`I am interested in this topic: '${title}'
Please send me full project details.

Name: ${name}
Mobile: ${mobile}
College: ${college}
Course: ${course}`;

    const waLink =
      `https://wa.me/${WHATSAPP_COUNTRY_CODE}${WHATSAPP_NUMBER}?text=` +
      encodeURIComponent(msg);

    window.open(waLink, '_blank');
  }
}

/* ============= SAVE TOPIC LEAD ============= */
async function selectTopic(topic){
  await saveLead({
    selected_topic_id: topic.id || topic.topicid || '',
    selected_topic_title: topic.title || topic.topic || ''
  });
}

/* ============= CUSTOM TOPIC REQUEST ============= */
async function handleCustomRequest(){
  const area = prompt('Enter short area of interest (e.g. digital marketing, supply chain):');
  if(!area || !area.trim()) return;

  await saveLead({
    selected_topic_id: '',
    selected_topic_title: '',
    area_of_interest: area.trim()
  });
}

/* ============= SAVE LEAD (common) ============= */
async function saveLead(fields){
  const mobile = $('mobile')?.value.trim() || '';
  const college = $('college')?.value.trim() || '';

  if(!validMobile(mobile)){
    toast('Enter valid mobile', 'error');
    goto('entry');
    return;
  }
  if(!college){
    toast('Enter college name', 'error');
    goto('entry');
    return;
  }

  const payload = {
    writeToken: WRITE_TOKEN,
    mobile,
    college,
    name: $('name')?.value.trim() || '',
    email: $('email')?.value.trim() || '',
    course: currentCourse || ($('courseSelect')?.value || ''),
    area_of_interest: fields.area_of_interest || '',
    selected_topic_id: fields.selected_topic_id || '',
    selected_topic_title: fields.selected_topic_title || '',
    userAgent: navigator.userAgent,
    notes: ''
  };

  const r = await apiPost(payload);
  if(r && r.success){
    const doneChoice = $('doneChoice');
    if(doneChoice){
      doneChoice.textContent =
        payload.selected_topic_title ||
        payload.area_of_interest ||
        'Request received';
    }

    // WhatsApp button on DONE page
    const msg =
`Hi Projectory — I selected: ${payload.selected_topic_title || payload.area_of_interest}
Mobile: ${payload.mobile}
College: ${payload.college}`;

    const waBtn = $('whatsappBtn');
    if(waBtn){
      waBtn.href =
        `https://wa.me/${WHATSAPP_COUNTRY_CODE}${WHATSAPP_NUMBER}?text=` +
        encodeURIComponent(msg);
      waBtn.style.display = 'inline-block';
    }

    toast('Saved!', 'success');
    goto('done');
  } else {
    toast('Failed to save: ' + (r && r.error ? r.error : 'Unknown error'), 'error');
    console.error('Save lead failed', r);
  }
}

/* ============= INITIAL LEAD WHEN COURSE SELECTED ============= */
async function saveInitialLead(){
  const mobile = $('mobile')?.value.trim() || '';
  const college = $('college')?.value.trim() || '';
  const course = $('courseSelect')?.value || '';

  if(!validMobile(mobile) || !college || !course) return;

  const key = mobile + '|' + course;
  if(initialLeadSavedFor[key]) return;

  const payload = {
    writeToken: WRITE_TOKEN,
    mobile,
    college,
    name: $('name')?.value.trim() || '',
    email: $('email')?.value.trim() || '',
    course,
    area_of_interest: '',
    selected_topic_id: '',
    selected_topic_title: '',
    userAgent: navigator.userAgent,
    notes: 'Initial lead — course selected'
  };

  const r = await apiPost(payload);
  if(r && r.success){
    initialLeadSavedFor[key] = true;
  }
}

/* ============= DOM READY ============= */
document.addEventListener('DOMContentLoaded', () => {
  // Entry → Courses
  const toCourseBtn = $('toCourseBtn');
  if(toCourseBtn){
    toCourseBtn.addEventListener('click', () => {
      const mobile = $('mobile')?.value || '';
      const college = $('college')?.value || '';

      if(!validMobile(mobile)){
        alert('Enter valid mobile');
        return;
      }
      if(!college.trim()){
        alert('Enter college name');
        return;
      }
      goto('courses');
    });
  }

  // Courses → Topics
  const seeTopicsBtn = $('seeTopicsBtn');
  if(seeTopicsBtn){
    seeTopicsBtn.addEventListener('click', async () => {
      const course = $('courseSelect')?.value || '';
      if(!course){
        alert('Select course');
        return;
      }
      currentCourse = course;
      await saveInitialLead();
      goto('topics');
    });
  }

  // Load more
  const loadMoreBtn = $('loadMoreBtn');
  if(loadMoreBtn){
    loadMoreBtn.addEventListener('click', () => renderTopicsPage(false));
  }

  // Custom topic
  const reqBtn = $('requestCustom');
  if(reqBtn){
    reqBtn.addEventListener('click', handleCustomRequest);
  }

  // Filter buttons
  const btnCollege = $('btnFilterCollege');
  if(btnCollege){
    btnCollege.addEventListener('click', () => showFilterBox('college'));
  }
  const btnLocation = $('btnFilterLocation');
  if(btnLocation){
    btnLocation.addEventListener('click', () => showFilterBox('location'));
  }

  // Apply / Clear filter
  const applyFilterBtn = $('applyFilterBtn');
  if(applyFilterBtn){
    applyFilterBtn.addEventListener('click', () => {
      const dd = $('filterDropdown');
      if(!dd) return;
      const val = dd.value.trim();
      if(!val){
        filteredTopics = null;
        renderTopicsPage(true);
        return;
      }

      filteredTopics = currentTopics.filter(t => {
        if(filterMode === 'college'){
          return t.college && t.college.toString().trim().toLowerCase() === val.toLowerCase();
        }
        if(filterMode === 'location'){
          return t.location && t.location.toString().trim().toLowerCase() === val.toLowerCase();
        }
        return false;
      });

      renderTopicsPage(true);
    });
  }

  const clearFilterBtn = $('clearFilterBtn');
  if(clearFilterBtn){
    clearFilterBtn.addEventListener('click', () => {
      filteredTopics = null;
      filterMode = '';
      const box = $('filterBox');
      if(box) box.style.display = 'none';
      renderTopicsPage(true);
    });
  }

  // Topics click (delegated)
  const topicsWrap = $('topicsWrap');
  if(topicsWrap){
    topicsWrap.addEventListener('click', topicsClickHandler);
  }

  // Start on home
  goto('home');
});
