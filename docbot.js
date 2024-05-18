const kD = '/d/';
const PROTO_DOC = {
    href() {
        return this.base + kD + this.id;
    },
    url() {
        return new URL(this.href());
    },
    api(path, searchParams = {}) {
        const url = new URL(this.href() + "/" + path);

        searchParams = {
            VER: '8',
            includes_info_params: 'true',
            // Haven't looked into the user id yet, hopefully unimportant
            u: 'ANONYMOUS_00801369372001435688',
            id: this.id,
            ...searchParams,
        }

        for (const key in searchParams) {
            if (searchParams[key] === null) continue;
            url.searchParams.set(key, searchParams[key]);
        }

        return url;
    },

    async fetchColorCookie() {
        const res = await fetch(this.url() + "/edit");

        const headers = res.headers;
        const cookies = headers.get('set-cookie');
        const s = cookies.indexOf('NID');
        const cookie = cookies.slice(s, cookies.indexOf('HttpOnly', s) + 8);

        return cookie.slice(0, cookie.indexOf(";"));
    }
}

const PROTO_BOT = {
    sid: "",
    cookie: "",
    doc: null,


    SID: null,
    binded: false,
    nextEventPromise: null,

    // JS signals riduculos
    life: null, // AbortController
    get binded() {
        if (!this.life) return false;

        return !this.life.signal.aborted;
    },
    events: null,

    async fetch(method, path, searchParams = {}, formData = null) {
        const endpoint = this.doc.api(path, {
            sid: this.sid,
            ...searchParams
        });

        if (formData !== null && !(formData instanceof FormData)) {
            const data = formData;

            formData = new FormData();
            for (const key in data) {
                formData.set(key, data[key]);
            }
        }
    
        const res = await fetch(endpoint, {
            headers: {
                cookie: this.cookie
            },
            // signal: this.life.signal.aborted ? null : this.life.signal,
            method,
            body: formData === null ? null : formData
        });

        return res;
    },

    // Referring to google drive's /bind endpoint,
    // this sets up the bot to stay alive
    bind() {
        this.life = new AbortController();
        this.life.signal.addEventListener("abort", () => {
            this.fetch("POST", "leave");
            this.nextEventPromise = null;
        });

        this._initBind().then((SID) => {
            this.SID = SID;

            this._keepBind();
        });

        this._setupNextEventPromise();

        this.events = {
            [Symbol.asyncIterator]() { return this },
            next: async () => {
                const event = await this.nextEventPromise;

                return {
                    value: event,
                    done: this.binded === false
                }
            }
        };

        return this;
    },

    select(sheetId, revId, col, row, w = 1, h = 2) {
        const MAGIC = 30710966;

        if (typeof sheetId !== "string") sheetId = sheetId.toString();

        return this.fetch("POST", "selection", {
            u: null,
            VER: null,
            includes_info_params: null
        }, {
            rev: revId,
            selection: JSON.stringify(
                [
                    MAGIC,
                    JSON.stringify([[
                        [sheetId, col, row],
                        [[sheetId, col, col + w, row, row + h]]
                    ]])
                ]
            )
        });
    },

    chat(msg) {
        return this.fetch("POST", "chat", {}, {
            sid: this.sid,
            msg
        });
    },

    leave() {
        if (!this.life) return;
        if (this.life.signal.aborted) return;

        this.life.abort();
    },

    _setupNextEventPromise() {
        let resolver;
        let rejecter;
        this.nextEventPromise = new Promise((res, rej) => {
            resolver = (event) => {
                res(event);

                this._setupNextEventPromise();
            }
            rejecter = (err) => {
                rej(err);

                this.life.abort();
                this.nextEventPromise = null;
            };
        });
        this.nextEventPromise.resolve = resolver;
        this.nextEventPromise.reject = rejecter;
    },

    async _digestEvents(events) {
        for (const event of events) {
            if (!this.binded) return;
            this.nextEventPromise.resolve(event);
            await null;
            await null;
        }
    },

    async _initBind() {
        const res = await this.fetch("POST", "bind");
        const body = await res.text();
    
        if (body.includes('Sorry, unable to open the file at this time.</p><p> Please check the address and try again.')) {
            throw new Error("Error in request. Could either be ratelimit or invalid doc id.");
        }

        const firstLineIndex = body.indexOf('\n');
        const events = JSON.parse(body.slice(firstLineIndex + 1));

        await this._digestEvents(events);

        return events[0][1][1];
    },

    _keepBind() {
        const resPromise = this.fetch("GET", "bind", {
            RID: 'rpc',
            CI: 0,
            AID: 25,
            TYPE: 'xmlhttp', // :)
            SID: this.SID
        })
        
        resPromise.then(async res => {

            // This code only made for node
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let body = "";
            while (this.binded) {
                let isDone;
                if (!body.includes("\n")) {
                    const { value: chunk, done } = await reader.read();
                    isDone = done;

                    body += decoder.decode(chunk, { stream: !done });

                    if (body.includes('Sorry, unable to open the file at this time.</p><p> Please check the address and try again.')) {
                        this.nextEventPromise?.reject(new Error("Error in request. Could either be ratelimit or invalid doc id."));
                        this.life.abort();
                        return;
                    }
                }

                const pos = body.indexOf('\n');
                if (pos === -1) continue;
        
                let line = body.slice(0, pos);

                line = line.slice(0, line.lastIndexOf(']') + 1);

                try {
                    if (line.length) {
                        await this._digestEvents(JSON.parse(line));
                    }
                } catch (err) {
                    this.life.abort();
                    this.nextEventPromise?.reject(err);
                    return;
                }

                body = body.slice(pos + 1);

                if (isDone && this.binded) {
                    this._keepBind();
                    break;
                }
            }
        });

        return resPromise;
    }

}

const newSid = () => {
    return Array(16)
        .fill(0)
        .map(_ => (~~(Math.random() * 16)).toString(16))
        .join('');
}




export const docFromUrl = (url) => {
    if (typeof url === 'string') {
        url = new URL(url);
    }

    const dPos = url.href.indexOf(kD);
    const base = url.href.slice(0, dPos);
    const id = url.href.slice(dPos + kD.length, url.href.indexOf('/', dPos + kD.length));
    return {
        base,
        id,
        __proto__: PROTO_DOC
    }
}

export const botForDoc = async (
    doc,
    { cookie, sid } = { cookie: null, sid: null }
) => {
    if (typeof doc === 'string') {
        doc = new URL(doc);
    }

    if (doc instanceof URL) {
        doc = docFromUrl(doc);
    }

    if (!sid) {
        sid = newSid();
    }

    if (!cookie) {
        cookie = await doc.fetchColorCookie();
    }
    
    return {
        doc,
        cookie,
        sid,

        __proto__: PROTO_BOT
    }
}


export const EVENT = {
    NOP: "noop",

    EDIT_SYNC: 0,
    META_SYNC: 1,
    USER_OPEN: 5,
    USER_LEAVE: 6,
    CHAT: 7,
    SELECTION: 10,
    // POST_COMMENT: 12
}
