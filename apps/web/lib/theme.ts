export const THEME_KEY = "mellodifai-theme";

// Plain shared data: the server must emit script text, not a client reference.
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");var c=document.documentElement.classList;if(t==="light"){c.remove("dark");c.add("light")}}catch(e){}`;
