import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { 
    getFirestore, doc, onSnapshot, setDoc, updateDoc, collection, 
    setLogLevel
} from 'firebase/firestore';
import { 
    List, MapPin, Loader, GripVertical, PlusCircle, Trash2, Home, 
    Calendar, Notebook, Edit, Check, Clock, Globe // 使用 Globe 代替 Link
} from 'lucide-react';

// --- 1. FIREBASE SETUP & UTILITIES ---

// Global variables provided by the environment
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'tokyo-trip-app';

// Initialization variables
let app, auth, db;
let unsubscribeSchedule = () => {};
let unsubscribeMemo = () => {};

// Firestore path constants
const BASE_PATH = `/artifacts/${appId}/public/data`;
const SCHEDULE_COLLECTION = `${BASE_PATH}/schedule`;
const MEMO_DOC = `${BASE_PATH}/memos/main`;

// Utility to extract the date from the title string (e.g., "Day 1: 抵達與池袋初探 (12/4)" -> "12/4")
const extractDate = (title) => {
    const match = title.match(/\((\d{1,2}\/\d{1,2})\)/);
    return match ? match[1] : 'N/A';
};

// Initial data structure (kept identical to previous version for seamless transition)
const initialScheduleData = {
    'day1': { 
        title: 'Day 1: 抵達與池袋初探 (12/4)', 
        items: [
            { id: '1-1', text: '抵達成田機場 (NRT)', type: 'transport', time: '14:00', note: '記得在機場購買 Suica 卡和利木津巴士票。', mapLink: 'https://maps.app.goo.gl/N9s3jFpYwR7yQzG26' },
            { id: '1-2', text: '搭利木津巴士前往飯店', type: 'transport', time: '15:30', note: '飯店：JR東日本大都會大飯店池袋', mapLink: 'https://maps.app.goo.gl/5t3y9F9oB4NqN712A' },
            { id: '1-3', text: 'Check-in 與行李安置', type: 'activity', time: '17:00', note: '在飯店大廳領取東京旅遊指南。', mapLink: '' },
            { id: '1-4', text: '池袋週邊晚餐與採買', type: 'activity', time: '19:00', note: '建議前往無敵家拉麵，需排隊。', mapLink: 'https://maps.app.goo.gl/2K8rGgX1wQ7pX7qV9' },
        ]
    },
    'day2': { 
        title: 'Day 2: 文青、散步與潮流 (12/5)', 
        items: [
            { id: '2-1', text: '早餐：PATH (代代木公園站)', type: 'food', time: '09:00', note: '人氣可頌麵包店，可能需提前到達。', mapLink: 'https://maps.app.goo.gl/N9s3jFpYwR7yQzG26' },
            { id: '2-2', text: '明治神宮散步', type: 'attraction', time: '10:30', note: '預計停留1.5小時。', mapLink: 'https://maps.app.goo.gl/2K8rGgX1wQ7pX7qV9' },
            { id: '2-3', text: '原宿竹下通/裏原宿逛街', type: 'shopping', time: '12:30', note: '目標：可愛襪子和可麗餅。', mapLink: 'https://maps.app.goo.gl/qJ8Q4m5ZpQ4yX7qV9' },
            { id: '2-4', text: '澀谷逛街 (Scramble Square/PARCO)', type: 'shopping', time: '15:00', note: '記得去Scramble Square觀景台。', mapLink: 'https://maps.app.goo.gl/Q7d4fA8LpT3yZ9Q49' },
            { id: '2-5', text: '澀谷晚餐 (待定)', type: 'food', time: '19:30', note: '備選：一蘭拉麵或壽司。', mapLink: '' },
        ],
        shoppingList: [
            { id: 's2-1', text: '澀谷 Scramble Square 觀景台門票', checked: false, listType: 'landmark' },
            { id: 's2-2', text: '原宿竹下通 可麗餅', checked: false, listType: 'buy' },
            { id: 's2-3', text: '[代買] 品牌 X T恤', checked: false, listType: 'buy' },
            { id: 's2-4', text: '[地標] 澀谷 Hachiko 銅像', checked: false, listType: 'landmark' },
        ]
    },
    'day3': { 
        title: 'Day 3: 新宿、丸之內與現代東京 (12/6)', 
        items: [
            { id: '3-1', text: '新宿御苑散步', type: 'attraction', time: '10:00', note: '帶野餐墊在草地休息。', mapLink: 'https://maps.app.goo.gl/P3s2dC7ApB1yW8P36' },
            { id: '3-2', text: '新宿站週邊逛街 (LUMINE, 伊勢丹)', type: 'shopping', time: '12:00', note: '主要看LUMINE EST的服飾。', mapLink: '' },
            { id: '3-3', text: '午餐：Udon Shinbori (うどん 慎)', type: 'food', time: '13:30', note: '熱門餐廳，排隊時間約30分鐘。', mapLink: 'https://maps.app.goo.gl/B4v7wX6ApP9zL1D27' },
            { id: '3-4', text: '東京車站週邊逛街 (KITTE, 丸之內)', type: 'shopping', time: '15:30', note: 'KITTE六樓有觀景台。', mapLink: 'https://maps.app.goo.gl/L9j1mK5ZpT8xZ7A8B' },
            { id: '3-5', text: '麻布台之丘 (Azabudai Hills) 參觀/逛街', type: 'attraction', time: '18:00', note: '新地標，晚上看東京鐵塔夜景。', mapLink: 'https://maps.app.goo.gl/H4v9xP1LpZ7xV3S09' },
        ],
        shoppingList: [
            { id: 's3-1', text: '[代買] 東京車站伴手禮 (N.Y.C. SAND)', checked: false, listType: 'buy' },
            { id: 's3-2', text: '[地標] 麻布台之丘 展望台', checked: false, listType: 'landmark' },
            { id: 's3-3', text: '[代買] 新宿 Isetan 百貨美妝品', checked: false, listType: 'buy' },
        ]
    },
    'day4': { 
        title: 'Day 4: 待安排自由日 (12/7)', 
        items: [
            { id: '4-1', text: '規劃中：推薦前往淺草/上野 (傳統文化)', type: 'suggestion', time: '10:00', note: '如果去淺草，可以租借和服。', mapLink: '' },
            { id: '4-2', text: '規劃中：推薦前往台場 (購物/夜景)', type: 'suggestion', time: '15:00', note: '如果去台場，晚餐可在附近解決。', mapLink: '' },
        ],
        shoppingList: [] 
    },
    'day5': { 
        title: 'Day 5: 東京迪士尼海洋 (12/8)', 
        items: [
            { id: '5-1', text: '早起，搭車前往舞濱站/迪士尼海洋', type: 'transport', time: '08:00', note: '確認電車時刻表。', mapLink: 'https://maps.app.goo.gl/K9l2nP8KpB7xM1E34' },
            { id: '5-2', text: '入園，啟動官方 App 搶 DPA/優先卡', type: 'activity', time: '09:00', note: '首要目標：驚魂古塔。', mapLink: '' },
            { id: '5-3', text: '暢玩設施與觀賞表演', type: 'activity', time: '12:00', note: '午餐：美人魚礁湖餐廳。', mapLink: '' },
            { id: '5-4', text: '觀賞夜間水上表演', type: 'attraction', time: '20:00', note: '確認表演時間和地點。', mapLink: '' },
        ],
        facilitiesList: [
            { id: 'f5-1', text: '驚魂古塔 (Tower of Terror)', checked: false },
            { id: 'f5-2', text: '地心探險 (Journey to the Center of the Earth)', checked: false },
            { id: 'f5-3', text: '印第安納瓊斯冒險旅程：水晶骷髏頭魔宮', checked: false },
            { id: 'f5-4', text: '[待定] 海底兩萬哩', checked: false },
        ]
    },
    'day6': { 
        title: 'Day 6: 告別東京 (12/9)', 
        items: [
            { id: '6-1', text: '飯店早餐與整理行李', type: 'food', time: '08:00', note: '打包戰利品。', mapLink: '' },
            { id: '6-2', text: 'Check-out (請注意時間)', type: 'activity', time: '10:00', note: '請勿超過早上11點。', mapLink: '' },
            { id: '6-3', text: '搭乘利木津巴士前往成田機場 (NRT)', type: 'transport', time: '11:00', note: '確認巴士站牌位置。', mapLink: 'https://maps.app.goo.gl/B4v7wX6ApP9zL1D27' },
            { id: '6-4', text: '辦理登機手續，搭機返程', type: 'transport', time: '14:00', note: '預計登機時間15:30。', mapLink: '' },
        ]
    }
};

// --- 2. THE APP COMPONENT ---

const App = () => {
    const [schedule, setSchedule] = useState(initialScheduleData);
    const [memos, setMemos] = useState([]);
    const [activeDay, setActiveDay] = useState('day1');
    const [authStatus, setAuthStatus] = useState({ userId: null, isLoading: true, isReady: false });
    const [activeTab, setActiveTab] = useState('schedule'); // 'schedule' or 'memo'

    // Initial Firebase & Auth Setup
    useEffect(() => {
        setLogLevel('error'); 

        try {
            if (!app) {
                app = initializeApp(firebaseConfig);
                auth = getAuth(app);
                db = getFirestore(app);
            }

            const checkAuth = async () => {
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken).catch(e => {
                        console.error("Custom token sign-in failed, trying anonymous.", e);
                        signInAnonymously(auth);
                    });
                } else {
                    await signInAnonymously(auth);
                }
            };
            
            const unsubscribe = onAuthStateChanged(auth, (user) => {
                const userId = user?.uid || null;
                setAuthStatus({ userId, isLoading: false, isReady: true });
                console.log(`Auth state changed. User ID: ${userId}`);
            });

            checkAuth();
            return () => {
                unsubscribe();
                unsubscribeSchedule();
                unsubscribeMemo();
            };
        } catch (error) {
            console.error("Firebase Initialization Error:", error);
            setAuthStatus({ userId: null, isLoading: false, isReady: false });
        }
    }, []);

    // Firestore Realtime Listeners (Triggers when auth is ready)
    useEffect(() => {
        // 確保 Auth 準備就緒後才設置監聽器
        if (!authStatus.isReady || !authStatus.userId || !db) return;

        // Listener for the main schedule (all days)
        const setupScheduleListener = () => {
            const scheduleRef = doc(db, SCHEDULE_COLLECTION, 'trip_data');
            unsubscribeSchedule = onSnapshot(scheduleRef, (docSnap) => {
                if (docSnap.exists() && docSnap.data().schedule) {
                    // Update state with remote data
                    setSchedule(docSnap.data().schedule);
                } else {
                    // If no data, try to upload initial data (only once)
                    console.log("No schedule found, initializing with default data.");
                    setDoc(scheduleRef, { schedule: initialScheduleData, lastUpdated: new Date() }).catch(e => console.error("Error setting initial schedule:", e));
                }
            }, (error) => {
                console.error("Schedule snapshot error:", error);
            });
        };

        // Listener for the General Memos list
        const setupMemoListener = () => {
            const memoRef = doc(db, MEMO_DOC);
            unsubscribeMemo = onSnapshot(memoRef, (docSnap) => {
                if (docSnap.exists() && docSnap.data().memos) {
                    setMemos(docSnap.data().memos);
                } else {
                    // Initialize Memos if missing
                    const defaultMemos = [
                        { id: crypto.randomUUID(), text: '機票確認 (12/4-12/9)', checked: true },
                        { id: crypto.randomUUID(), text: '迪士尼 App 下載與帳號註冊', checked: false },
                        { id: crypto.randomUUID(), text: '購買 JR N\'EX 或 Skyliner 往返車票', checked: false },
                        { id: crypto.randomUUID(), text: '兌換日幣現金 ¥50,000', checked: false },
                    ];
                    setMemos(defaultMemos);
                    setDoc(memoRef, { memos: defaultMemos, lastUpdated: new Date() }).catch(e => console.error("Error setting initial memos:", e));
                }
            }, (error) => {
                console.error("Memo snapshot error:", error);
            });
        };

        setupScheduleListener();
        setupMemoListener();

        // Cleanup on unmount or auth change
        return () => {
            unsubscribeSchedule();
            unsubscribeMemo();
        };
    }, [authStatus.isReady, authStatus.userId]);

    // --- Data Handlers ---

    // Function to save the entire schedule to Firestore
    const saveSchedule = useCallback(async (newSchedule) => {
        if (!authStatus.isReady || !authStatus.userId) return;
        const scheduleRef = doc(db, SCHEDULE_COLLECTION, 'trip_data');
        try {
            await updateDoc(scheduleRef, { schedule: newSchedule, lastUpdated: new Date() });
        } catch (e) {
            console.error("Error updating schedule: ", e);
        }
    }, [authStatus.isReady, authStatus.userId]);

    // Function to save the entire memos array to Firestore
    const saveMemos = useCallback(async (newMemos) => {
        if (!authStatus.isReady || !authStatus.userId) return;
        const memoRef = doc(db, MEMO_DOC);
        try {
            await setDoc(memoRef, { memos: newMemos, lastUpdated: new Date() });
        } catch (e) {
            console.error("Error updating memos: ", e);
        }
    }, [authStatus.isReady, authStatus.userId]);

    // Handles adding a new item to the daily schedule
    const addDailyItem = (dayKey, text) => {
        const newSchedule = { ...schedule };
        const newId = crypto.randomUUID();
        const time = ''; 
        const type = text.includes('餐') || text.includes('食') ? 'food' : text.includes('逛') || text.includes('買') ? 'shopping' : 'activity';
        
        newSchedule[dayKey].items = [...newSchedule[dayKey].items, { 
            id: newId, 
            text, 
            type, 
            time,
            note: '', 
            mapLink: '' 
        }];
        saveSchedule(newSchedule);
    };

    // Handles updating an existing daily item (content, time, note, mapLink)
    const updateDailyItem = (dayKey, itemId, newText, newTime, newNote, newMapLink) => {
        const newSchedule = { ...schedule };
        const day = newSchedule[dayKey];
        const itemIndex = day.items.findIndex(item => item.id === itemId);
        
        if (itemIndex !== -1) {
            day.items[itemIndex] = { 
                ...day.items[itemIndex], 
                text: newText, 
                time: newTime,
                note: newNote,       
                mapLink: newMapLink  
            };
            saveSchedule(newSchedule);
        }
    };

    // Handles removing a list item (utility function)
    const removeItem = (dayKey, listName, itemId) => {
        if (listName === 'memos') {
            const newMemos = memos.filter(item => item.id !== itemId);
            saveMemos(newMemos);
        } else {
            const newSchedule = { ...schedule };
            newSchedule[dayKey][listName] = newSchedule[dayKey][listName].filter(item => item.id !== itemId);
            saveSchedule(newSchedule);
        }
    };

    // Handles reordering of daily itinerary items
    const reorderDailyItems = (dayKey, startIndex, endIndex) => {
        const newSchedule = { ...schedule };
        const [removed] = newSchedule[dayKey].items.splice(startIndex, 1);
        newSchedule[dayKey].items.splice(endIndex, 0, removed);
        saveSchedule(newSchedule);
    };

    // Helper to get icon for daily item type
    const getItemIcon = (type) => {
        switch(type) {
            case 'transport': return <MapPin className="w-5 h-5" />;
            case 'food': return <Home className="w-5 h-5" />;
            case 'shopping': return <List className="w-5 h-5" />;
            case 'attraction': return <GripVertical className="w-5 h-5" />;
            case 'suggestion': return <Globe className="w-5 h-5" />;
            case 'activity':
            default: return <Calendar className="w-5 h-5" />;
        }
    };

    // Current day's data
    const currentDayData = useMemo(() => schedule[activeDay] || { title: '', items: [] }, [schedule, activeDay]);
    
    // Generates sorted keys with date labels for the tab selector
    const sortedDayKeys = useMemo(() => {
        return Object.keys(schedule).map(key => ({
            key,
            date: extractDate(schedule[key].title)
        }));
    }, [schedule]);

    // --- UI Components ---

    // Component for the daily itinerary item (with editing for time, text, note, mapLink)
    const DailyItineraryItem = ({ item, index, onDragStart, onDragOver, onDrop, onRemove, onUpdate, dayKey }) => {
        const [isEditing, setIsEditing] = useState(false);
        const [editText, setEditText] = useState(item.text);
        const [editTime, setEditTime] = useState(item.time || '');
        const [editNote, setEditNote] = useState(item.note || '');
        const [editMapLink, setEditMapLink] = useState(item.mapLink || '');
        
        const dragOverItem = React.useRef(null);
        
        const handleSave = () => {
            onUpdate(dayKey, item.id, editText.trim(), editTime.trim(), editNote.trim(), editMapLink.trim());
            setIsEditing(false);
        };

        const handleDragStartLocal = (e) => {
            onDragStart(e, index);
        };

        const handleDropLocal = (e) => {
            onDrop(e, index);
        };

        const handleDragEndLocal = (e) => {
            e.currentTarget.classList.remove('opacity-50', 'border-2', 'border-cyan-500');
        }
        
        // 驗證地圖連結是否有效
        const isValidUrl = (url) => {
            try {
                return url && (url.startsWith('http://') || url.startsWith('https://'));
            } catch (e) {
                return false;
            }
        };

        const iconColor = item.type === 'food' ? 'text-amber-500' : 
                          item.type === 'shopping' ? 'text-pink-500' : 
                          item.type === 'transport' ? 'text-blue-500' : 
                          'text-cyan-500';

        return (
            <div 
                draggable
                onDragStart={handleDragStartLocal}
                onDragOver={(e) => { e.preventDefault(); }} 
                onDrop={handleDropLocal}
                onDragEnter={(e) => { dragOverItem.current = index; }}
                onDragEnd={handleDragEndLocal}
                className="flex items-start p-5 mb-4 bg-white rounded-3xl shadow-lg border border-gray-100 cursor-grab active:cursor-grabbing transition duration-200 ease-in-out hover:shadow-xl group"
                data-index={index}
            >
                {/* Time Indicator & Drag Handle */}
                <div className="flex flex-col items-center flex-shrink-0 mr-4 mt-1 w-12 text-center">
                    <p className={`text-lg font-bold ${item.time ? 'text-gray-800' : 'text-gray-400'}`}>
                        {item.time || 'N/A'}
                    </p>
                    <GripVertical className="w-4 h-4 text-gray-300 group-hover:text-cyan-500 transition cursor-grab" />
                </div>

                {/* Vertical Separator */}
                <div className="w-px h-auto bg-gray-200 mx-2 -my-1"></div>

                {/* Content Area */}
                <div className="flex-grow ml-4">
                    
                    {/* Main Text & Edit/Save Buttons */}
                    <div className="flex justify-between items-start mb-2">
                        {/* 內容編輯區 */}
                        <div className="flex-grow mr-3">
                            {isEditing ? (
                                <textarea
                                    value={editText}
                                    onChange={(e) => setEditText(e.target.value)}
                                    className="w-full text-base font-semibold text-gray-900 border border-cyan-300 rounded p-2 focus:ring-cyan-500 focus:border-cyan-500"
                                    rows="1"
                                    placeholder="行程內容"
                                />
                            ) : (
                                <p className="text-base font-semibold text-gray-900 leading-snug">{item.text}</p>
                            )}
                        </div>
                        
                        {/* Action Buttons */}
                        <div className="flex-shrink-0 flex items-center space-x-2 mt-1">
                            {isEditing ? (
                                <button onClick={handleSave} className="p-1 text-green-500 hover:text-green-600 transition" aria-label="儲存變更">
                                    <Check className="w-5 h-5" />
                                </button>
                            ) : (
                                <button onClick={() => setIsEditing(true)} className="p-1 text-gray-500 hover:text-cyan-500 transition" aria-label="編輯行程">
                                    <Edit className="w-5 h-5" />
                                </button>
                            )}
                            <button 
                                onClick={() => onRemove(dayKey, 'items', item.id)}
                                className="p-1 text-red-400 hover:text-red-600 transition"
                                aria-label="移除行程"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                    
                    {/* Meta Details: Note & Map Link */}
                    <div className="mt-3 space-y-2">
                        {/* 附註 (Note) */}
                        <div className="text-sm text-gray-600">
                            <div className="flex items-center">
                                <Notebook className="w-4 h-4 mr-1.5 text-gray-400 flex-shrink-0" />
                                <span className="font-medium text-gray-700">附註:</span>
                            </div>
                            {isEditing ? (
                                <textarea
                                    value={editNote}
                                    onChange={(e) => setEditNote(e.target.value)}
                                    className="w-full text-sm text-gray-700 border border-gray-200 rounded p-2 mt-1 focus:ring-cyan-500 focus:border-cyan-500"
                                    rows="2"
                                    placeholder="新增備註或細節..."
                                />
                            ) : (
                                <p className="text-sm italic text-gray-500 whitespace-pre-wrap ml-6">{item.note || '無'}</p>
                            )}
                        </div>
                        
                        {/* 地圖連結 (Map Link) */}
                        <div className="flex items-center mt-2">
                            {isEditing ? (
                                <div className='flex-grow'>
                                    <div className="flex items-center mb-1">
                                        <MapPin className="w-4 h-4 mr-1.5 text-gray-400 flex-shrink-0" />
                                        <label className="text-sm font-medium text-gray-700">地圖連結:</label>
                                    </div>
                                    <input 
                                        type="url"
                                        value={editMapLink}
                                        onChange={(e) => setEditMapLink(e.target.value)}
                                        className="w-full text-sm text-blue-600 border border-blue-200 rounded p-2 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="Google Map URL"
                                    />
                                </div>
                            ) : (
                                isValidUrl(item.mapLink) ? (
                                    <a 
                                        href={item.mapLink} 
                                        target="_blank" 
                                        rel="noopener noreferrer" 
                                        className="flex items-center text-sm text-blue-600 hover:text-blue-700 transition font-semibold"
                                    >
                                        <MapPin className="w-4 h-4 mr-1" />
                                        地圖連結 (開啟)
                                    </a>
                                ) : (
                                    <span className="flex items-center text-sm text-gray-400">
                                        <MapPin className="w-4 h-4 mr-1" />
                                        無地圖連結
                                    </span>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // Main view for a single day's itinerary (ScheduleView)
    const ScheduleView = () => {
        const [newItemText, setNewItemText] = useState('');

        const dragItem = React.useRef(null);
        const dragOverItem = React.useRef(null);

        const handleDragStart = (e, index) => {
            dragItem.current = index;
            e.currentTarget.classList.add('opacity-50', 'border-2', 'border-cyan-500');
        };

        const handleDragOver = (e) => {
            e.preventDefault();
        };

        const handleDrop = (e, index) => {
            e.preventDefault();
            const droppedIndex = dragOverItem.current !== null ? dragOverItem.current : index;

            if (dragItem.current !== droppedIndex) {
                reorderDailyItems(activeDay, dragItem.current, droppedIndex);
            }

            e.currentTarget.classList.remove('opacity-50', 'border-2', 'border-cyan-500');
            dragItem.current = null;
            dragOverItem.current = null;
        };

        const handleAddItem = (e) => {
            e.preventDefault();
            if (newItemText.trim()) {
                addDailyItem(activeDay, newItemText.trim());
                setNewItemText('');
            }
        };

        // Handles checking/unchecking a list item (shopping/facilities/memos)
        const toggleCheck = (dayKey, listName, itemId) => {
            if (listName === 'memos') {
                const newMemos = memos.map(item => item.id === itemId ? { ...item, checked: !item.checked } : item);
                saveMemos(newMemos);
            } else {
                const newSchedule = { ...schedule };
                newSchedule[dayKey][listName] = newSchedule[dayKey][listName].map(item => 
                    item.id === itemId ? { ...item, checked: !item.checked } : item
                );
                saveSchedule(newSchedule);
            }
        };

        // Handles adding a new item to a list (shopping/facilities)
        const addListItem = (dayKey, listName, text) => {
            const newSchedule = { ...schedule };
            const newId = crypto.randomUUID();
            const listType = listName === 'shoppingList' ? (text.includes('地標') ? 'landmark' : 'buy') : 'facility';
            
            newSchedule[dayKey][listName] = [
                ...(newSchedule[dayKey][listName] || []), 
                { id: newId, text, checked: false, listType }
            ];
            saveSchedule(newSchedule);
        };

        // Current day's lists (Shopping/Facilities)
        const currentLists = useMemo(() => {
            const lists = [];
            if (currentDayData.shoppingList && currentDayData.shoppingList.length > 0) {
                lists.push({
                    name: '購物/地標清單',
                    key: 'shoppingList',
                    data: currentDayData.shoppingList
                });
            }
            if (currentDayData.facilitiesList && currentDayData.facilitiesList.length > 0) {
                lists.push({
                    name: '設施願望清單',
                    key: 'facilitiesList',
                    data: currentDayData.facilitiesList,
                    link: "https://www.tokyodisneyresort.jp/en/tdr/app.html" // Disney App Link
                });
            }
            return lists;
        }, [currentDayData]);


        const [newListText, setNewListText] = useState('');
        const [activeListKey, setActiveListKey] = useState(currentLists[0]?.key || 'shoppingList'); 

        const handleAddListItem = (e) => {
            e.preventDefault();
            if (newListText.trim() && activeListKey) {
                addListItem(activeDay, activeListKey, newListText.trim());
                setNewListText('');
            }
        };

        // Generic list item component for checklists
        const ListItem = ({ item, dayKey, listName, onToggle, onRemove }) => {
            const Icon = item.listType === 'landmark' ? MapPin : List;
            return (
                <div className="flex items-center p-4 mb-3 bg-white rounded-xl shadow-sm border border-gray-100 transition duration-150 ease-in-out hover:shadow-md">
                    <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={() => onToggle(dayKey, listName, item.id)}
                        className="w-5 h-5 text-cyan-600 bg-gray-100 border-gray-300 rounded focus:ring-cyan-500 focus:ring-2"
                    />
                    <div className="flex-grow ml-4 text-sm text-gray-800 break-words">
                        <span className={`font-medium ${item.checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                            {item.text}
                        </span>
                    </div>
                    {item.listType && (
                        <div className={`ml-2 flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${item.listType === 'landmark' ? 'bg-blue-100 text-blue-600' : 'bg-pink-100 text-pink-600'}`}>
                            <Icon className="w-3 h-3 mr-1" />
                            {item.listType === 'landmark' ? '地標' : '採買'}
                        </div>
                    )}
                    <button 
                        onClick={() => onRemove(dayKey, listName, item.id)}
                        className="ml-3 p-1 text-red-400 hover:text-red-600 transition"
                        aria-label="移除項目"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            );
        };


        return (
            <div className="p-4 pt-6 md:p-8 md:pt-10 max-w-2xl mx-auto">
                {/* Header */}
                <h1 className="text-4xl font-extrabold text-gray-900 mb-1">東京雙人行</h1>
                <p className="text-xl font-bold text-gray-600 mb-2">{currentDayData.title.split(': ')[0]}</p>
                <p className="text-lg text-cyan-600 font-medium mb-8">{currentDayData.title.split(': ')[1]}</p>

                {/* Daily Itinerary */}
                <div className="mb-10">
                    <h2 className="text-2xl font-bold text-gray-800 mb-5 flex items-center">
                        <Clock className="w-6 h-6 mr-2 text-cyan-500" />
                        當日行程
                    </h2>
                    <div className="space-y-4">
                        {currentDayData.items.map((item, index) => (
                            <DailyItineraryItem
                                key={item.id}
                                item={item}
                                index={index}
                                dayKey={activeDay}
                                onDragStart={handleDragStart}
                                onDragOver={handleDragOver}
                                onDrop={handleDrop}
                                onRemove={removeItem}
                                onUpdate={updateDailyItem}
                            />
                        ))}
                    </div>
                    <form onSubmit={handleAddItem} className="mt-6 flex shadow-lg rounded-3xl overflow-hidden">
                        <input
                            type="text"
                            value={newItemText}
                            onChange={(e) => setNewItemText(e.target.value)}
                            placeholder="新增行程：例如 18:00 晚餐"
                            className="flex-grow p-4 border-none focus:ring-0 text-base"
                        />
                        <button type="submit" className="p-4 bg-cyan-600 text-white hover:bg-cyan-700 transition">
                            <PlusCircle className="w-6 h-6" />
                        </button>
                    </form>
                </div>

                {/* Shopping/Facility Lists */}
                {currentLists.map((list) => (
                    <div key={list.key} className="mb-8">
                        <h2 className="text-xl font-bold text-gray-800 mb-5 flex items-center">
                            <List className="w-5 h-5 mr-2 text-pink-500" />
                            {list.name}
                            {list.link && (
                                <a href={list.link} target="_blank" rel="noopener noreferrer" className="ml-3 text-sm font-semibold text-blue-500 hover:underline">
                                    [App 連結]
                                </a>
                            )}
                        </h2>
                        <div className="space-y-3">
                            {list.data.map(item => (
                                <ListItem
                                    key={item.id}
                                    item={item}
                                    dayKey={activeDay}
                                    listName={list.key}
                                    onToggle={toggleCheck}
                                    onRemove={removeItem}
                                />
                            ))}
                        </div>
                        
                        <form onSubmit={handleAddListItem} className="mt-6 flex shadow-md rounded-xl overflow-hidden">
                            <input
                                type="text"
                                value={activeListKey === list.key ? newListText : ''}
                                onChange={(e) => { setNewListText(e.target.value); setActiveListKey(list.key); }}
                                placeholder={list.key === 'shoppingList' ? "新增地標或代買清單" : "新增設施名稱"}
                                className="flex-grow p-3 border-none focus:ring-0 text-sm"
                            />
                            <button type="submit" className="p-3 bg-pink-500 text-white hover:bg-pink-600 transition">
                                <PlusCircle className="w-5 h-5" />
                            </button>
                        </form>
                    </div>
                ))}
            </div>
        );
    };

    // MemoView
    const MemoView = () => {
        const [newMemoText, setNewMemoText] = useState('');

        const handleAddMemo = (e) => {
            e.preventDefault();
            if (newMemoText.trim()) {
                const newMemos = [...memos, { id: crypto.randomUUID(), text: newMemoText.trim(), checked: false }];
                saveMemos(newMemos);
                setNewMemoText('');
            }
        };
        
        // Handles checking/unchecking a list item (memos)
        const toggleCheck = (dayKey, listName, itemId) => {
            if (listName === 'memos') {
                const newMemos = memos.map(item => item.id === itemId ? { ...item, checked: !item.checked } : item);
                saveMemos(newMemos);
            } 
        };

        // Handles removing a list item
        const removeItem = (dayKey, listName, itemId) => {
            if (listName === 'memos') {
                const newMemos = memos.filter(item => item.id !== itemId);
                saveMemos(newMemos);
            }
        };

        // Generic list item component for checklists
        const ListItem = ({ item, onToggle, onRemove }) => {
            return (
                <div className="flex items-center p-4 mb-3 bg-white rounded-xl shadow-sm border border-gray-100 transition duration-150 ease-in-out hover:shadow-md">
                    <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={() => onToggle(null, 'memos', item.id)}
                        className="w-5 h-5 text-cyan-600 bg-gray-100 border-gray-300 rounded focus:ring-cyan-500 focus:ring-2"
                    />
                    <div className="flex-grow ml-4 text-base text-gray-800 break-words">
                        <span className={`font-medium ${item.checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                            {item.text}
                        </span>
                    </div>
                    <button 
                        onClick={() => onRemove(null, 'memos', item.id)}
                        className="ml-3 p-1 text-red-400 hover:text-red-600 transition"
                        aria-label="移除項目"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            );
        };


        return (
            <div className="p-4 pt-6 md:p-8 md:pt-10 max-w-2xl mx-auto">
                <h1 className="text-3xl font-extrabold text-gray-900 mb-8 flex items-center">
                    <Notebook className="w-7 h-7 mr-2 text-cyan-600" />
                    旅行備忘錄
                </h1>

                <div className="space-y-3 mb-8">
                    {memos.map(item => (
                        <ListItem
                            key={item.id}
                            item={item}
                            onToggle={toggleCheck}
                            onRemove={removeItem}
                        />
                    ))}
                </div>

                <form onSubmit={handleAddMemo} className="mt-6 flex shadow-lg rounded-3xl overflow-hidden">
                    <input
                        type="text"
                        value={newMemoText}
                        onChange={(e) => setNewMemoText(e.target.value)}
                        placeholder="新增一則備忘事項..."
                        className="flex-grow p-4 border-none focus:ring-0 text-base"
                    />
                    <button type="submit" className="p-4 bg-cyan-600 text-white hover:bg-cyan-700 transition">
                        <PlusCircle className="w-6 h-6" />
                    </button>
                </form>

                <div className="mt-12 p-4 bg-gray-100 rounded-xl border border-gray-200">
                    <p className="font-semibold text-gray-700">協作狀態：</p>
                    <p className="text-sm text-gray-500 mt-1">目前使用者 ID: {authStatus.userId || '未登入'}</p>
                </div>
            </div>
        );
    };


    // Main Renderer
    return (
        <div className="min-h-screen bg-gray-50 font-sans pb-28">
            {/* Global iOS-like font stack */}
            <style>{`
                body {
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
                }
            `}</style>
            
            {/* Loading/Error State */}
            {authStatus.isLoading && (
                <div className="flex justify-center items-center h-screen">
                    <Loader className="w-8 h-8 animate-spin text-cyan-500" />
                    <p className="ml-3 text-gray-600">正在同步行程資料...</p>
                </div>
            )}

            {/* Main Content */}
            {!authStatus.isLoading && authStatus.isReady && (
                <>
                    {/* Main View Area */}
                    <div className="pb-16">
                        {activeTab === 'schedule' ? <ScheduleView /> : <MemoView />}
                    </div>

                    {/* Minimalist Fixed Tab Bar */}
                    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-2xl shadow-gray-200 max-w-2xl mx-auto z-10 rounded-t-3xl">
                        <div className="flex justify-around h-16">
                            <button
                                onClick={() => setActiveTab('schedule')}
                                className={`flex flex-col items-center justify-center w-full transition duration-150 ${activeTab === 'schedule' ? 'text-cyan-600' : 'text-gray-400 hover:text-cyan-500'}`}
                            >
                                <Calendar className="w-6 h-6" />
                                <span className="text-xs font-medium">行程</span>
                            </button>
                            <button
                                onClick={() => setActiveTab('memo')}
                                className={`flex flex-col items-center justify-center w-full transition duration-150 ${activeTab === 'memo' ? 'text-cyan-600' : 'text-gray-400 hover:text-cyan-500'}`}
                            >
                                <Notebook className="w-6 h-6" />
                                <span className="text-xs font-medium">備忘錄</span>
                            </button>
                        </div>
                        {/* Date Selector (Minimalist Style) */}
                        {activeTab === 'schedule' && (
                            <div className="absolute -top-12 left-0 right-0 h-12 bg-white border-t border-gray-100 overflow-x-auto whitespace-nowrap scrollbar-hide">
                                <div className="flex py-2 px-3 space-x-2">
                                    {sortedDayKeys.map(({ key, date }) => (
                                        <button
                                            key={key}
                                            onClick={() => setActiveDay(key)}
                                            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition ${activeDay === key ? 'bg-cyan-500 text-white shadow-md' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                        >
                                            {date}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default App;