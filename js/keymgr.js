/** @property mega.keyMgr */
lazy(mega, 'keyMgr', () => {
    'use strict';

    Object.defineProperty(self, 'secureKeyMgr', {
        get() {
            return mega.keyMgr.secure && mega.keyMgr.generation > 0;
        },
        configurable: true
    });
    const logger = MegaLogger.getLogger('KeyMgr');
    const dump = logger.warn.bind(logger, 'Caught Promise Rejection');

    const expungePendingOutShares = (u8, nodes, users = false, emails = false) => {
        const sub = $.len(users) || $.len(emails);
        const any = !sub && nodes === false;

        let match = false;
        let len = u8.byteLength;

        for (let p = 0; p < len;) {
            // match by node
            const n = ab_to_base64(new Uint8Array(u8.buffer, u8.byteOffset + p + 1, 6));

            if (any || nodes.includes(n)) {
                match = true;
            }
            else if (sub) {
                const ptr = new Uint8Array(u8.buffer, u8.byteOffset + p + 7, u8[p] || 8);

                match = emails && emails[n + ab_to_str(ptr)]
                    || users && users[n + ab_to_base64(ptr)];
            }

            const l = u8[p] ? u8[p] + 7 : 15;

            if (match) {
                // delete l byes and shorten len by l
                u8.set(new Uint8Array(u8.buffer, u8.byteOffset + p + l, len - p - l), p);
                len -= l;
                match = false;
            }
            else {
                p += l;
            }
        }

        return new Uint8Array(u8.buffer, u8.byteOffset, len);
    };

    const cleanupCachedAttribute = async() => {
        if (u_attr['^!keys']) {
            logger.warn('Cleaning ug-provided ^!keys attribute.');
            delete u_attr['^!keys'];
        }
        return attribCache.removeItem(`${u_handle}_^!keys`);
    };

    const syncRemoteKeysAttribute = async(keyMgr) => {
        await cleanupCachedAttribute();

        return Promise.resolve(mega.attr.get(u_handle, 'keys', -2, true))
            .then((result) => {
                assert(typeof result === 'string' && result.length > 0, `KeyMgr: Bogus fetch-result, "${result}"`);

                return keyMgr.importKeysContainer(result);
            })
            .catch((ex) => {
                cleanupCachedAttribute().catch(dump);
                throw ex;
            });
    };

    const kmWebLock = self.LockManager && navigator.locks instanceof self.LockManager
        ? async(handler) => navigator.locks.request('KeyMgr-readwrite.lock', handler)
        : async(handler) => handler();

    const eventlog = (...args) => {
        if (window.buildOlderThan10Days) {
            logger.warn(...args);
        }
        else {
            queueMicrotask(() => window.eventlog(...args));
        }
    };

    const isValidMasterKey = (key) => Array.isArray(key) && key.length === 4 && Math.max(...key) >>> 0;

    if (!window.is_karma) {
        let gMasterKey = window.u_k;

        delete window.u_k;
        Object.defineProperty(window, 'u_k', {
            get() {
                if (d > 8) {
                    logger.warn('Feeding master-key for user %s...', u_handle);
                }
                return gMasterKey;
            },
            set(value) {
                const valid = value === undefined || isValidMasterKey(value);

                if (!valid || value
                    && mega.keyMgr.equal(Uint32Array.from(value), Uint32Array.from(gMasterKey || []))) {

                    if (!valid || mega.keyMgr.version) {
                        logger.error('Forbidden attempt to replace the master-key...', !!value);
                    }
                    return;
                }

                if (d) {
                    const user = window.u_handle || $.createanonuser || 'anon';

                    if (gMasterKey) {
                        logger.warn('%s master-key for user %s...', value ? 'Replacing' : 'Removing', user);
                    }
                    else {
                        logger.warn('Establishing new master-key for user %s.', user);
                    }
                }

                // @todo ensure there is nothing pending/running concurrently given the reset() call..

                gMasterKey = value;
                mega.keyMgr.reset();
            }
        });
    }

    return new class KeyMgr {

        constructor() {
            this.reset();
        }

        reset() {
            const ownKeys = Reflect.ownKeys(this);

            for (let i = ownKeys.length; i--;) {
                delete this[ownKeys[i]];
            }

            // share keys that an upload is allowed to encrypt to
            // { uploadid : [ targetnode, [ sharenode, sharenode, ... ] ] }
            this.uploads = Object.create(null);

            // nodes under a newly shared node at the time the user opened the sharing dialog
            // (only these will be included in the cr element of the s/s2 command)
            // all newer nodes received their shareufskey through the share being announced
            // to other clients via the ^!keys update
            this.sharechildren = Object.create(null);

            // trusted sharekeys never had MITM/API exposure
            this.trustedsharekeys = Object.create(null);

            // deserialised sharekeys are known to be in ^!keys
            this.deserialisedsharekeys = Object.create(null);

            // in-session freshly created share-keys
            this.createdsharekey = Object.create(null);

            // a commit() attempt was unsuccessful due to incomplete state
            this.pendingcommit = null;

            // indicates an unresolved version clash
            this.versionclash = false;

            // feature flag: enable with the blog post going live
            this.secure = false;

            /** @property KeyMgr.ph -- Protocol Handler instance */
            lazy(this, 'ph', () => {
                return new strongvelope.ProtocolHandler(u_handle, u_privCu25519, u_privEd25519, u_pubEd25519);
            });
        }

        async initKeyManagement(keys) {
            if (this.version || this.fetchPromise || !window.u_privk) {
                throw new SecurityError('Unexpected Key Management Initialization.');
            }

            if (this.secure) {
                if (decWorkerPool.ok) {
                    decWorkerPool.signal({assign: true, secureKeyMgr: true});
                }
                Object.defineProperty(self, 'secureKeyMgr', {value: true});
            }

            if (keys) {
                return this.importKeysContainer(keys, -0x4D454741);
            }

            if (d) {
                logger.warn('Setting up ^!keys store management... post-reg=%s', this.postregistration);
            }

            if (this.secure && !this.postregistration) {
                // inform the user not to accept this message more than once
                // and remind him of his outgoing shared folders, if any.

                // eslint-disable-next-line max-len -- @todo Transifex
                let msg = `Your account's security is now being upgraded. This will happen only once. If you have seen this message for this account before, press Cancel.`;

                const shared = Object.values(M.getOutShareTree()).map(n => n.name).filter(Boolean);
                if (shared.length) {
                    msg += `\n\nYou are currently sharing the following ${shared.length} folders: ${shared.join(', ')}`;
                }

                // eslint-disable-next-line no-alert -- @todo non-alert blocking method..
                if (!confirm(msg)) {
                    location.replace('https://mega.io/support?resilience=1');
                }
            }
            else {
                this.postregistration = false;
            }

            // TLV container format version
            this.version = 1;

            // initial creation time of this blob (static) for forensic analysis after deletion/recreation attacks
            this.creationtime = this.uint32u8(Date.now() / 1000);

            // user handle - for a very basic sanity check (static)
            this.identity = new Uint8Array(base64_to_ab(u_handle), 0, 8);

            // generation count, monotonically increasing with every commit
            // purpose: detect replay attacks of older versions
            this.generation = 1;

            // generic attributes { string : Uint8Array }
            this.attr = Object.create(null);

            // asymmetric private keys
            this.prived25519 = this.str2u8(u_privEd25519);
            this.privcu25519 = this.str2u8(u_privCu25519);
            this.privrsa = this.str2u8(crypto_encodeprivkey2(u_privk));

            // pending outshares - ( \0 + nodehandle.6 + userhandle + 8 | \email.length + nodehandle.6 + email )*
            this.pendingoutshares = new Uint8Array(0);

            // pending inshares - { node : u8( userhandle + encryptedsharekey ) }
            this.pendinginshares = Object.create(null);

            // share keys that a backup is allowed to encrypt to
            // { backupid : [ targetnode, [ sharenode, sharenode, ... ] ] }
            this.backups = Object.create(null);

            // cryptographic warnings { warningid : warning }
            this.warnings = Object.create(null);

            // unprocessed tags
            this.other = new Uint8Array(0);

            return this.commit();
        }

        async setKey(basekey) {
            if (!this.gcmkey) {
                assert(isValidMasterKey(basekey), 'Invalid base-key.');

                const key = await crypto.subtle.importKey(
                    "raw",
                    new Uint8Array(a32_to_ab(basekey)),
                    "HKDF",
                    false,
                    ["deriveKey"]
                );

                this.gcmkey = await crypto.subtle.deriveKey(
                    {name: 'HKDF', salt: new Uint8Array(0), info: new Uint8Array([1]), hash: 'SHA-256'},
                    key,
                    {name: 'AES-GCM', length: 128},
                    true,
                    ['encrypt', 'decrypt']
                );

                Object.defineProperty(this.gcmkey, 'bk', {
                    value: basekey,
                    configurable: true
                });
            }
        }

        serialise() {
            return this.tlvConcat(this.other, [
                1, new Uint8Array([this.version]),
                2, this.creationtime,
                3, this.identity,
                4, this.uint32u8(this.generation),
                5, this.obj2u8(this.attr),
                16, this.prived25519,
                17, this.privcu25519,
                18, this.privrsa,
                32, this.str2u8(authring.serialise(u_authring.Ed25519)),
                33, this.str2u8(authring.serialise(u_authring.Cu25519)),
                48, this.serialiseShareKeys(u_sharekeys),
                64, this.pendingoutshares,
                65, this.obj2u8(this.pendinginshares),
                80, this.backups2u8(this.backups),
                96, this.obj2u8(this.warnings)
            ]);
        }

        unserialise(blob) {
            let val;
            let p = 4;
            const tagpos = Object.create(null);

            while (p <= blob.length) {
                const tag = blob[p - 4];
                const len = (blob[p - 3] << 16) + (blob[p - 2] << 8) + blob[p - 1];

                if (p + len > blob.length) {
                    return false;
                }
                tagpos[tag] = [p, len];
                p += len + 4;
            }

            const version = this.gettlv(blob, tagpos, 1)[0];
            if (!version) {
                return false;
            }

            const creationtime = this.gettlv(blob, tagpos, 2);
            if (creationtime.byteLength !== 4) {
                return false;
            }

            const identity = this.gettlv(blob, tagpos, 3);
            if (ab_to_base64(identity) !== u_handle) {
                return false;
            }

            if ((val = this.gettlv(blob, tagpos, 4)).byteLength !== 4) {
                return false;
            }

            const generation = this.u8uint32(val);
            if (d) {
                logger.info(`Generation: ${generation}`);
            }

            const attr = this.u82obj(this.gettlv(blob, tagpos, 5));

            // deserialise static members only once
            if (this.keyring) {
                logger.info('Keyring already established, not overwriting...');
                assert(this.equal(this.privrsa, this.gettlv(blob, tagpos, 18)), 'prRSA');
                assert(this.equal(this.privcu25519, this.gettlv(blob, tagpos, 17)), 'prCu255');
                assert(this.equal(this.prived25519, this.gettlv(blob, tagpos, 16)), 'prEd255');
            }
            else {

                const prived25519 = this.gettlv(blob, tagpos, 16);
                if (prived25519.length !== 32) {
                    return false;
                }

                const privcu25519 = this.gettlv(blob, tagpos, 17);
                if (privcu25519.length !== 32) {
                    return false;
                }

                const privrsa = this.gettlv(blob, tagpos, 18);
                if (privrsa.length < 512) {
                    return false;
                }

                this.keyring = Object.create(null);
                this.keyring.prEd255 = ab_to_str(prived25519);
                this.keyring.prCu255 = ab_to_str(privcu25519);

                this.privrsa = privrsa;
                this.prived25519 = prived25519;
                this.privcu25519 = privcu25519;

                u_privk = crypto_decodeprivkey2(this.privrsa);
            }

            this.attr = attr;
            this.version = version;
            this.identity = identity;
            this.generation = generation;
            this.creationtime = creationtime;

            this.authrings = Object.create(null);

            val = this.gettlv(blob, tagpos, 32);
            this.authrings.Ed25519 = authring.deserialise(this.u82str(val));

            val = this.gettlv(blob, tagpos, 33);
            this.authrings.Cu25519 = authring.deserialise(this.u82str(val));

            this.deserialiseShareKeys(this.gettlv(blob, tagpos, 48));

            this.pendingoutshares = this.gettlv(blob, tagpos, 64);
            this.pendinginshares = this.u82obj(this.gettlv(blob, tagpos, 65));

            this.backups = this.u82backups(this.gettlv(blob, tagpos, 80));
            this.warnings = this.u82obj(this.gettlv(blob, tagpos, 96));

            // we don't touch unknown tags written by a newer version
            const unk = [];

            if ($.len(tagpos)) {
                logger.warn('Unknown tags...', JSON.stringify(tagpos));
            }

            for (const tag in tagpos) {
                val = this.gettlv(blob, tagpos, tag);
                if (val.byteLength) {
                    unk.push(tag, val);
                }
            }
            this.other = this.tlvConcat([], unk);

            return true;
        }

        // utility functions - move elsewhere?
        str2u8(s) {
            const u8 = new Uint8Array(s.length);

            for (let i = s.length; i--;) {
                u8[i] = s.charCodeAt(i);
            }

            return u8;
        }

        // concatenate arguments to form a TLV blob. The first argument is appended to the end.
        tlvConcat(other, payload) {
            // calculate final length
            let size = other.length;

            for (let i = 1; i < payload.length; i += 2) {
                size += payload[i].length + 4;
            }

            // allocate and populate buffer
            const blob = new Uint8Array(size);
            let p = 0;

            for (let i = 0; i < payload.length; i += 2) {
                // set header
                blob[p] = payload[i];
                const len = payload[i + 1].length;

                blob.set([len >> 16 & 255, len >> 8 & 255, len & 255], p + 1);

                // copy data
                blob.set(payload[i + 1], p + 4);

                p += len + 4;
            }

            // append raw blob
            if (other.length) {
                blob.set(other, p);
            }

            return blob;
        }

        // extract tlv subfield and remove from pos/len array
        gettlv(blob, tagpos, index) {
            const p = tagpos[index][0];
            const len = tagpos[index][1];

            delete tagpos[index];

            return new Uint8Array(blob.buffer, p, len);
        }

        // convert hash of { strings : Uint8Arrays } to Uint8Array
        // format: taglen.8 tagstring size.16be (if -1, followed by size.32be) data
        obj2u8(obj) {
            let size = 0;

            for (const name in obj) {
                size += name.length + 1 + obj[name].length + 2;
                if (obj[name].length > 65534) {
                    size += 4;
                }
            }

            const blob = new Uint8Array(size);
            const view = new DataView(blob.buffer);
            let p = 0;

            for (const name in obj) {
                blob[p] = name.length;
                for (let i = name.length; i--;) {
                    blob[p + i + 1] = name.charCodeAt(i);
                }

                p += name.length + 1;

                size = obj[name].length;
                if (size < 65535) {
                    view.setUint16(p, size);
                    p += 2;
                }
                else {
                    view.setInt16(p, -1);
                    view.setUint32(p + 2, size);
                    p += 6;
                }

                blob.set(obj[name], p);
                p += size;
            }

            return blob;
        }

        // revert the above with zero data copying (no error checking is performed)
        u82obj(blob) {
            let p = 0;
            const obj = Object.create(null);
            const view = new DataView(blob.buffer, blob.byteOffset);

            while (p < blob.length) {
                let size = blob[p];
                let name = '';

                for (let i = 0; i < size; i++) {
                    name += String.fromCharCode(blob[p + i + 1]);
                }

                p += size + 1;
                size = view.getUint16(p);

                if (size === 65535) {
                    size = view.getUint32(p + 2);
                    p += 4;
                }

                obj[name] = new Uint8Array(blob.buffer, p + 2, size);
                p += size + 2;
            }

            return obj;
        }

        uint32u8(val) {
            const u8 = new Uint8Array(4);
            new DataView(u8.buffer).setUint32(0, val);
            return u8;
        }

        u8uint32(blob) {
            return new DataView(blob.buffer).getUint32(blob.byteOffset);
        }

        u82str(blob) {
            let b = '';

            for (let i = 0; i < blob.length; i++) {
                b += String.fromCharCode(blob[i]);
            }

            return b;
        }

        // converts sharekeys into a series of struct { handle[6]; key[16]; } in a Uint8Array
        serialiseShareKeys(keys) {
            const blob = new Uint8Array(Object.keys(keys).length * 23);
            const view = new DataView(blob.buffer);
            let p = 0;

            for (const h in keys) {
                const bh = atob(h);

                for (let i = 0; i < 6; i++) {
                    blob[p + i] = bh.charCodeAt(i);
                }

                for (let i = 4; i--;) {
                    view.setInt32(p + 6 + i * 4, keys[h][0][i]);
                }

                if (this.trustedsharekeys[h]) {
                    blob[p + 22] = 1;
                }

                p += 23;
            }

            return blob;
        }

        // replaces u_sharekeys with the contents of the serialised blob
        // retains existing records if possible to reduce overhead
        deserialiseShareKeys(blob) {
            const view = new DataView(blob.buffer, blob.byteOffset);

            for (let p = 0; p < blob.length; p += 23) {
                const h = ab_to_base64(blob.slice(p, p + 6).buffer);
                const k = [view.getInt32(p + 6), view.getInt32(p + 10), view.getInt32(p + 14), view.getInt32(p + 18)];

                // we recycle the old u_sharekeys[] record if it is unchanged
                if (!u_sharekeys[h] || !this.equal(u_sharekeys[h][0], k)) {
                    if (d && u_sharekeys[h]) {
                        logger.warn(`Replacing share-key for ${h}`, u_sharekeys[h][0], k);
                    }
                    crypto_setsharekey2(h, k);
                }

                if (blob[p + 22]) {
                    this.trustedsharekeys[h] = true;
                }

                this.deserialisedsharekeys[h] = true;
            }
        }

        // unpack target / share node handles from binary blob
        u82backups(blob) {
            const r = this.u82obj(blob);

            for (const backupid in r) {
                const ahandles = ab_to_base64(r[backupid]);

                r[backupid] = [ahandles.substr(0, 8), []];

                for (let i = 8; i < ahandles.length; i += 8) {
                    r[backupid][1].push(ahandles.substr(i, 8));
                }
            }

            return r;
        }

        // pack target / share node handles and tlv-encode to blob
        backups2u8(backups) {
            const r = Object.create(null);

            for (const backupid in backups) {
                r[backupid] = new Uint8Array(
                    base64_to_ab(backups[backupid][0] + backups[backupid][1].join('')),
                    0,
                    (backups[backupid][1].length + 1) * 6
                );
            }

            return this.obj2u8(r);
        }

        // compare [typed]array/string
        equal(a, b) {
            const len = a.length;

            if (len === b.length) {
                let i = -1;
                while (++i < len) {
                    if (a[i] !== b[i]) {
                        return false;
                    }
                }
                return true;
            }
            return false;
        }

        // serialise and encrypt
        async getKeysContainer() {
            const {u_k} = window;
            const iv = crypto.getRandomValues(new Uint8Array(12));

            if (!this.gcmkey) {
                await this.setKey(u_k);
            }
            assert(this.equal(this.gcmkey.bk, u_k), 'Unexpected GCM Key..');

            const ciphertext = await crypto.subtle.encrypt(
                {name: "AES-GCM", iv},
                this.gcmkey,
                this.serialise()
            );

            return ab_to_str(new Uint8Array([20, 0])) + ab_to_str(iv) + ab_to_str(ciphertext);
        }

        // decrypt and unserialise
        async importKeysContainer(s, stage) {
            if (s === this.prevkeys) {
                if (d) {
                    logger.debug('The current ^!keys were written by ourselves, not processing.');
                }
                return;
            }
            this.prevkeys = s;

            if (d) {
                logger.warn('Importing keys...', s && s.length);
            }

            // header format: 20 / reserved (always 0)
            if (s.charCodeAt(0) !== 20) {
                throw new SecurityError('Unexpected key repository, please try again later.');
            }
            const algo = {name: "AES-GCM", iv: this.str2u8(s.substr(2, 12))};
            const {u_k} = window;

            if (!this.gcmkey) {
                await this.setKey(u_k);
            }
            assert(this.equal(this.gcmkey.bk, u_k), 'Unexpected GCM Key.');

            const res = await crypto.subtle.decrypt(algo, this.gcmkey, this.str2u8(s.substr(14)))
                .catch((ex) => {
                    logger.error(ex);
                    throw new SecurityError(`Your key repository cannot be read (${s.length}) Please try again later.`);
                });

            if (!this.unserialise(new Uint8Array(res))) {
                throw new SecurityError(`
                    The cryptographic state of your account appears corrupt.
                    Your data cannot be accessed safely. Please try again later.
                `);
            }
            // @todo logger.assert() at api3
            console.assert(this.generation > 0, `Unexpected generation... ${this.generation}`, typeof this.generation);

            if (this.generation) {
                const lastKnown = parseInt(await this.getGeneration().catch(dump));

                if (lastKnown && this.generation < lastKnown) {

                    if (stage === -0x4D454741) {
                        logger.warn('downgrade-attack? verifying...', lastKnown, this.generation);

                        return this.fetchKeyStore().dump('KeyMgr.staged.fetch');
                    }
                    logger.error('downgrade attack', lastKnown, this.generation);
                    eventlog(99812, JSON.stringify([4, this.generation, lastKnown]));

                    /**
                    msgDialog('warninga', l[135], `
                      A downgrade attack has been detected. Removed shares may have reappeared. Please tread carefully.
                    `);
                     /**/
                }
                else if (!lastKnown || this.generation > lastKnown) {
                    return this.setGeneration(this.generation).catch(dump);
                }
            }
            /** @returns void */
        }

        // newest known generation persistence.
        async setGeneration(generation) {
            const key = `keysgen_${u_handle}`;

            tryCatch(() => localStorage.setItem(key, generation))();
            await M.setPersistentData(key, generation).catch(dump);
            /** @returns void */
        }

        async getGeneration() {
            const {u_handle} = window;
            console.assert(String(u_handle).length === 11, 'check this..', u_handle);

            const key = `keysgen_${u_handle}`;
            let value = parseInt(tryCatch(() => localStorage.getItem(key))()) || 0;

            if (typeof M.getPersistentData === 'function') {
                const dbValue = parseInt(await M.getPersistentData(key).catch(nop)) || 0;

                if (dbValue !== value) {
                    if (dbValue > value) {
                        logger.warn('Redundancy collision, db > ls', dbValue, value);
                    }
                    else {
                        logger.warn('Redundancy collision, ls > db', value, dbValue);
                    }
                }

                value = Math.max(value, dbValue);
            }

            return value || false;
        }

        // fetch current state from versioned user variable ^!keys
        async fetchKeyStore() {
            if (d) {
                logger.warn('*** FETCH', this.commitPromise, this.fetchPromise);
            }

            // piggyback onto concurent commit()s
            if (this.commitPromise) {
                return this.commitPromise;
            }

            // aggregate concurrent fetch()es
            if (this.fetchPromise) {
                return this.fetchPromise;
            }
            this.fetchPromise = mega.promise;

            kmWebLock(() => syncRemoteKeysAttribute(this))
                .catch((ex) => {
                    // @todo recover/repair the keys-container (?)
                    logger.error(ex);
                    logger.error(ex);
                    logger.error(ex);
                    eventlog(99813, JSON.stringify([4, String(ex).trim().split('\n')[0]]));
                })
                .finally(() => {
                    this.resolveCommitFetchPromises(false);
                });

            return this.fetchPromise;
        }

        // commit current state to ^!keys
        // cmds is an array of supplemental API commands to run with the attribute put
        // FIXME: run cmd in bc mode
        async commit(cmds, ctx) {
            if (!this.version) {
                if (d) {
                    logger.warn('*** NOT LOADED, cannot commit.');
                }
                return true;
            }
            if (d) {
                logger.warn('*** COMMIT', this.commitPromise, this.fetchPromise);
            }

            if (!u_keyring || !u_privCu25519) {
                if (d) {
                    logger.warn('*** INCOMPLETE STATE');
                }
                this.pendingcommit = true;
                return true;
            }

            // piggyback onto concurrent fetch() (it will signal a failed commit(), triggering a retry)
            if (this.fetchPromise) {
                return this.fetchPromise;
            }

            if (this.commitPromise) {
                // only the first commit() must return success
                // all subsequent concurrent (piggybacking) commit()s must return failure so that they get retried
                if (!this.commitRetryPromise) {
                    this.commitRetryPromise = mega.promise;
                }
                return this.commitRetryPromise;
            }

            this.commitPromise = mega.promise;

            kmWebLock(() => this.updateKeysAttribute(cmds, ctx))
                .then(() => {

                    if (d && this.versionclash) {
                        logger.log('Resolved versioning clash after %d retries', this.versionclash | 0);
                    }

                    this.versionclash = false;
                    this.resolveCommitFetchPromises(true);
                })
                .catch((ex) => {

                    if (this.versionclash) {

                        if (this.versionclash > 4) {
                            eventlog(99814, true);
                            logger.error("Too many versioning-clash errors -- FIXME.", ex);
                        }

                        if (d) {
                            logger.warn('Retrying last commit on version clash...', this.versionclash, ex);
                        }
                    }
                    else if (d) {
                        logger.error('*** FAIL', ex);
                    }

                    tSleep(2 + -Math.log(Math.random()) * 4)
                        .then(() => this.resolveCommitFetchPromises(false));
                });

            this.pendingcommit = false;
            return this.commitPromise;
        }

        async updateKeysAttribute(cmds, ctx) {
            // tentatively increment generation and store
            const generation = ++this.generation;

            return this.getKeysContainer()
                .then((result) => {
                    if (cmds) {
                        api_req(cmds, ctx);
                    }
                    this.prevkeys = result;

                    // FIXME: link cmds and mega.attr.set cmd in bc mode -- @todo api3
                    return Promise.resolve(
                        mega.attr.set('keys', result, -2, true, undefined, undefined, undefined, true)
                    );
                })
                .then((result) => {
                    assert(generation === this.generation);

                    if (d) {
                        logger.log(`new generation ${generation}`, result);
                    }
                    return this.setGeneration(generation).catch(dump);
                })
                .catch(async(ex) => {

                    if (ex === EEXPIRED) {

                        if (d) {
                            logger.warn('Version clash, retrieving remote attribute...', this.versionclash);
                        }

                        this.versionclash++;
                        await syncRemoteKeysAttribute(this);
                    }

                    throw ex;
                });
        }

        // overlapping commit()s/fetch()s are not permitted
        // this resets and then resolves all related promises
        resolveCommitFetchPromises(r) {
            const p = this.commitPromise;
            this.commitPromise = false;

            const rp = this.commitRetryPromise;
            this.commitRetryPromise = false;

            const fp = this.fetchPromise;
            this.fetchPromise = false;

            if (d) {
                logger.warn('Resolving promises...', r, p, rp, fp);
            }

            if (p) {
                p.resolve(r);
            }

            if (rp) {
                rp.resolve(false);
            }

            if (fp) {
                fp.resolve();
            }
        }

        // commit() with autoretry until successful
        // no-op if we haven't fetched or initialised yet
        async commitWithRetry() {
            if (!this.generation) {
                return;
            }

            const {generation} = this;

            while (!await this.commit() || generation === this.generation) {
                if (d) {
                    logger.log('commit with retry');
                }
            }
        }

        // take snapshot of the prevailing sharekeys at backup creation time
        async setBackup(id, node) {
            if (!this.generation) {
                return;
            }

            do {
                this.backups[id] = [node, await this.pathShares(node)];
            } while (!await this.commit());
        }

        async setUpload(id, node) {
            this.uploads[id] = [node, await this.pathShares(node)];
        }

        // returns a shared node's path back to root
        async pathShares(node) {
            const sharedNodes = [];

            if (!M.d[node]) {
                await dbfetch.get(node);
            }

            while (M.d[node]) {
                if (u_sharekeys[node]) {
                    sharedNodes.push(node);
                }
                node = M.d[node].p;
            }

            return sharedNodes;
        }

        // FIXME: discontinue SEEN status
        async cacheVerifiedPeerKeys(userHandle) {
            const promises = [];

            if (!pubCu25519[userHandle]) {
                promises.push(crypt.getPubCu25519(userHandle));
            }

            if (!pubEd25519[userHandle]) {
                promises.push(crypt.getPubEd25519(userHandle));
            }

            return promises.length && Promise.all(promises)
                .catch((ex) => {
                    logger.warn(`pub-key(s) retrieval failed for ${userHandle}`, [ex]);
                    eventlog(99815, JSON.stringify([2, userHandle, String(ex).trim().split('\n')[0]]));
                });
        }

        haveVerifiedKeyFor(userHandle) {
            // trusted key available?
            const ed = authring.getContactAuthenticated(userHandle, 'Ed25519');
            const cu = authring.getContactAuthenticated(userHandle, 'Cu25519');

            return cu && cu.method >= authring.AUTHENTICATION_METHOD.SIGNATURE_VERIFIED
                && ed && ed.method >= authring.AUTHENTICATION_METHOD.FINGERPRINT_COMPARISON;
        }

        // encrypt blob to peer (keys must be cached)
        encryptTo(blob, userHandle) {
            if (!this.haveVerifiedKeyFor(userHandle)) {
                return false;
            }

            return this.ph._encryptKeysTo([blob], userHandle);
        }

        // decrypt blob from peer (keys must be cached) (returns array of KEY_SIZE chunks)
        decryptFrom(blob, userHandle) {
            if (!this.haveVerifiedKeyFor(userHandle)) {
                return false;
            }

            const r = this.ph._decryptKeysFrom(blob, userHandle);

            if (Array.isArray(r)) {
                return r[0];
            }
            return false;

        }

        // try decrypting inshares based on the current key situation
        async decryptInShares() {
            const promises = [];

            const fix = async(h) => {
                const nodes = await M.getNodes(h, true);
                crypto_fixmissingkeys(array.to.object(nodes));
            };

            for (const node in u_sharekeys) {
                if (M.d[node] && M.d[node].name === undefined) {

                    promises.push(fix(node));
                }
            }

            return Promise.all(promises);
        }

        // pending inshare keys (from this.pendinginshares)
        // from peers whose keys are verified and cached will be decrypted, set and removed from ^!keys
        async acceptPendingInShareCacheKeys() {
            if (!this.generation) {
                return;
            }

            // (new users appearing during the commit attempts will not be cached and have to wait for the next round)
            do {
                let changed = false;

                for (const node in this.pendinginshares) {
                    if (u_sharekeys[node]) {
                        // already have it
                        delete this.pendinginshares[node];
                        changed = true;
                    }
                    else {
                        const t = this.pendinginshares[node];
                        const s = ab_to_str(new Uint8Array(t.buffer, t.byteOffset + 8));
                        const u = ab_to_base64(new Uint8Array(t.buffer, t.byteOffset, 8));

                        const sharekey = this.decryptFrom(s, u);

                        if (sharekey) {
                            // decrypted successfully - set key and delete record
                            crypto_setsharekey(node, str_to_a32(sharekey), false, true);
                            delete this.pendinginshares[node];
                            changed = true;
                        }
                    }
                }

                if (!changed) {
                    if (d) {
                        logger.warn('acceptPendingInShareCacheKeys: Nothing changed.');
                    }
                    break;
                }
            } while (!await this.commit());
        }

        // cache peer public keys required to decrypt pendinginshare
        // then, try to decrypt them and persist the remainder for retry later
        async acceptPendingInShares() {
            const promises = [];

            // cache senders' public keys
            for (const node in this.pendinginshares) {
                const {buffer, byteOffset} = this.pendinginshares[node];

                promises.push(this.cacheVerifiedPeerKeys(ab_to_base64(new Uint8Array(buffer, byteOffset, 8))));
            }

            await Promise.allSettled(promises);
            await this.acceptPendingInShareCacheKeys();

            return this.decryptInShares();
        }

        // fetch pending inshare keys from the API, decrypt inshares for trusted sender keys, store in ^!keys otherwise
        // (idempotent operation)
        async fetchPendingInShareKeys() {
            let rem;

            if (d) {
                logger.warn('Fetching pending in-share keys...');
            }

            // fetch pending inshare keys and add them to pendinginshares
            const res = await Promise.resolve(M.req({a: 'pk'})).catch(echo);

            if (typeof res == 'object') {
                if (d) {
                    logger.info('pk.res', res);
                }
                rem = res.d;
                delete res.d;

                for (const userHandle in res) {
                    const uhab = new Uint8Array(base64_to_ab(userHandle), 0, 8);

                    for (const node in res[userHandle]) {
                        if (!u_sharekeys[node]) {
                            // construct userhandle / key blob and add it to pendinginshares
                            const t = new Uint8Array(24);
                            t.set(uhab);
                            t.set(new Uint8Array(base64_to_ab(res[userHandle][node])), 8);
                            this.pendinginshares[node] = t;
                        }
                    }
                }
            }

            // decrypt trusted keys, store the remaining ones
            await this.acceptPendingInShares();

            // we can now delete the fetched inshare keys from the queue
            // (if this operation fails, no problem, it's all idempotent)
            return rem && M.req({a: 'pk', d: rem});
        }

        // sanity check: don't allow inshare keys on cloud drive nodes
        isInShare(node) {
            for (; ;) {
                if (!M.d[node]) {
                    // we have reached the parent of the inshare
                    return true;
                }
                if (!M.d[node].p) {
                    // no parent: cloud drive root
                    return false;
                }

                node = M.d[node].p;
            }
        }

        // tells whether the node belongs to a trusted share
        isTrusted(node) {
            if (!this.trustedsharekeys[node]) {
                console.assert(!this.secure || u_sharekeys[node], 'share-clash..');
                return false;
            }

            return this.secure;
        }

        // meant to append cr-element only once during share
        hasNewShareKey(node) {
            if (this.createdsharekey[node]) {
                this.createdsharekey[node] = false;
                return true;
            }
            return false;
        }

        // creates a sharekey for a node and sends the subtree's shareufskeys to the API
        // FIXME: (this must be called right before opening the share dialog
        //         to prevent the API from clandestinely adding nodes later)
        async createShare(node, fromsetsharekey) {
            let sharekey;

            if (u_sharekeys[node]) {
                sharekey = u_sharekeys[node][0];
            }
            else {
                sharekey = [...crypto.getRandomValues(new Int32Array(4))];

                if (this.secure) {
                    this.trustedsharekeys[node] = true;
                }
            }

            // take a snapshot of the current tree under node
            // (FIXME: repeat snapshot upon commit() clashing once sn tagging is implemented to
            // prevent race conditions)

            // sharekey holds either the existing or the newly created sharekey.
            // commit it to ^!keys.
            do {
                // save sharekey (since fetch() does not delete it, there is no need to set it again
                // after a commit failure...  just leaving it in the loop to be robust against that
                // approach changing
                if (!u_sharekeys[node]) {
                    crypto_setsharekey2(node, sharekey);
                    this.createdsharekey[node] = true;
                }

                // also, authorise this sharekey to be targeted by active backups and uploads
                // also, authorise this sharekey to be targeted for ongoing uploads
                this.addShare(node, this.uploads);
                this.addShare(node, this.backups);
            } while (!this.deserialisedsharekeys[node] && !await this.commit());

            if (!fromsetsharekey) {
                crypto_setsharekey(node, u_sharekeys[node][0], true, true);
            }
        }

        // delete u_sharekeys[node] and commit the change to ^!keys
        async deleteShares(nodes) {
            do {
                let changed = false;

                for (let i = nodes.length; i--;) {
                    if (u_sharekeys[nodes[i]]) {
                        delete u_sharekeys[nodes[i]];
                        delete this.trustedsharekeys[nodes[i]];
                        delete this.deserialisedsharekeys[nodes[i]];
                        changed = true;
                    }
                }

                const {byteLength} = this.pendingoutshares || {};
                if (byteLength) {
                    const tmp = expungePendingOutShares(this.pendingoutshares, nodes);

                    if (tmp.byteLength !== byteLength) {
                        this.pendingoutshares = tmp;
                        changed = true;
                    }
                }

                if (!changed) {
                    if (d) {
                        logger.warn('deleteShares: Nothing changed.');
                    }
                    break;
                }
            } while (!await this.commit());
        }

        // authorise all uploads or backups under node to encrypt to sharekey
        // structure of uploads/backups: id => [node, [key1, key2, ...]]
        addShare(sharenode, t) {
            for (const id in t) {
                for (let p = t[id][0]; p; p = M.d[p].p) {
                    if (p === sharenode) {
                        t[1].push(sharenode);
                    }
                }
            }
        }

        // the user just opened the sharing dialog:
        // we create a snapshot of the child nodes (unless we already have one)
        // and authorise further uploads/backups into the tree
        // FIXME: add reentrant behaviour
        async setShareSnapshot(node) {

            // snapshot exists?
            if (!this.sharechildren[node]) {
                this.createShare(node).catch(dump);
                this.sharechildren[node] = await M.getNodes(node, true);
            }
        }

        // retrieve previously created share-nodes snapshot
        getShareSnapshot(node) {
            const res = this.sharechildren[node];
            delete this.sharechildren[node];
            return res;
        }

        // create pending outshare key records and try to send them to
        // the target users (requiring them to have a verified public key)
        async sendShareKeys(node, users) {
            if (d) {
                logger.info('*** sending share-keys', users, [node]);
            }

            if (users && users.length) {
                await this.createPendingOutShares(node, users);
                return this.completePendingOutShares();
            }
        }

        // pending outshares
        // associate targetuser (handle or email address) with a node
        async createPendingOutShares(node, targetusers) {
            if (!this.generation) {
                return;
            }

            do {
                let t = this.pendingoutshares;

                for (let j = 0; j < targetusers.length; ++j) {
                    const targetuser = targetusers[j];

                    if (targetuser.length && targetuser.length < 256) {
                        if (!targetuser.includes('@') && targetuser.length === 11) {
                            // store as NUL + 12-byte node-user pair
                            const tt = new Uint8Array(t.length + 15);
                            tt.set(new Uint8Array(base64_to_ab(node + targetuser), 0, 14), 1);
                            tt.set(t, 15);
                            t = tt;
                        }
                        else if (targetuser !== 'EXP') {
                            // store as targetuser.length + 8-byte node plus ASCII email address + targetuser
                            const tt = new Uint8Array(t.length + targetuser.length + 7);
                            tt[0] = targetuser.length;
                            tt.set(new Uint8Array(base64_to_ab(node), 0, 6), 1);
                            for (let i = 0; i < targetuser.length; i++) {
                                tt[i + 7] = targetuser.charCodeAt(i);
                            }
                            tt.set(t, targetuser.length + 7);
                            t = tt;
                        }
                    }
                }

                if (t === this.pendingoutshares) {
                    if (d) {
                        logger.warn('createPendingOutShares: Nothing changed.');
                    }
                    break;
                }

                this.pendingoutshares = t;

            } while (!await this.commit());
        }

        // remove pending outshares
        // nodes, nodeusers and nodeemails are objects with keys indicating the outshare to be removed
        // { nodehandle : 1 }, { nodehandle + userhandle : 1 }, { nodehandle + email : 1 }
        async deletePendingOutShares(nodes, nodeusers = false, nodeemails = false) {
            // keyMgr not intialised yet - bail
            if (!this.pendingoutshares.byteLength) {
                return;
            }

            do {
                const tmp = expungePendingOutShares(this.pendingoutshares, nodes, nodeusers, nodeemails);

                if (tmp.byteLength === this.pendingoutshares.byteLength) {
                    if (d) {
                        logger.warn('deletePendingOutShares: Nothing changed.');
                    }
                    break;
                }

                this.pendingoutshares = tmp;

            } while (!await this.commit());
        }

        // complete all pending outshares that have a userhandle attached for which we have an authenticated public key
        // (this is idempotent and must be called at app start to cater for aborts during the previous run)
        async completePendingOutShares() {
            if (!this.generation) {
                return;
            }

            // first, expand the binary pendingoutshares blob
            const t = this.pendingoutshares;
            const pending = [];
            const promises = [];

            for (let p = 0; p < t.length;) {
                if (t[p]) {
                    // pending user - email address
                    const email = String.fromCharCode.apply(null, t.subarray(p + 7, t[p] + 7));
                    const uh = M.getUserByEmail(email).u;

                    // FIXME: risk of crossover attacks
                    if (uh) {
                        pending.push([ab_to_base64(new Uint8Array(t.buffer, t.byteOffset + p + 1, 6)), uh]);
                    }

                    p += t[p] + 7;
                }
                else {
                    // known user handle
                    const nodeuser = ab_to_base64(new Uint8Array(t.buffer, t.byteOffset + p + 1, 14));
                    pending.push([nodeuser.substr(0, 8), nodeuser.substr(8, 11)]);
                    p += 15;
                }
            }

            // step 1: cache recipients' keys
            for (let i = pending.length; i--;) {
                promises.push(this.cacheVerifiedPeerKeys(pending[i][1]));
            }
            await Promise.allSettled(promises);

            // step 2: encrypt sharekeys to cached recipients and queue to the API
            const deletePendingNode = [];
            const deletePendingNodeUser = Object.create(null);

            for (let i = pending.length; i--;) {
                if (u_sharekeys[pending[i][0]]) {    // do we still have a sharekey for the node?
                    // attempt completion for pending outshares that have a userhandle attached
                    const shareKeyForPeer = this.encryptTo(a32_to_str(u_sharekeys[pending[i][0]][0]), pending[i][1]);

                    if (shareKeyForPeer) {
                        api_req({a: 'pk', u: pending[i][1], h: pending[i][0], k: base64urlencode(shareKeyForPeer)});
                        deletePendingNodeUser[pending[i][0] + pending[i][1]] = true;
                    }
                }
                else {
                    // we have no sharekeys for the node - delete
                    deletePendingNode.push(pending[i][0]);
                }
            }

            return this.deletePendingOutShares(deletePendingNode, deletePendingNodeUser);
        }

        // adjust the permitted sharekeys for any backup or upload under
        // the nodes being moved through locally initiated action
        async moveNodesApiReq(cmds, ctx) {
            if (!this.generation) {
                api_req(cmds, ctx);
                return;
            }

            do {
                // we temporarily instantly speculatively complete the moves
                for (let i = 0; i < cmds.length; i++) {
                    const n = M.d[cmds[i].n];
                    if (n && n.t) {
                        // a folder is being moved - record old parent and move it to the new location
                        cmds[i].pp = n.p;
                        n.p = cmds[i].t;
                    }
                }

                let changed = false;

                // and then replace the permitted backup sharekeys
                for (const backupid in this.backups) {
                    // FIXME: detect changes
                    changed |= this.setRefShareNodes(this.backups[backupid]);
                }

                // also replace permitted upload sharekeys
                for (const uploadid in this.uploads) {
                    // FIXME: detect changes
                    this.setRefShareNodes(this.uploads[uploadid]);
                }

                // undo speculative instant completion
                // FIXME - this is prone to race condition by concurrent user action or actionpackets
                for (let i = 0; i < cmds.length; i++) {
                    if (cmds[i].pp) {
                        const n = M.d[cmds[i].n];

                        if (n && n.p === cmds[i].t) {
                            // a folder is being moved - record old parent and move it to the new location
                            n.p = cmds[i].pp;
                        }

                        delete cmds[i].pp;
                    }
                }
                if (!changed) {
                    api_req(cmds, ctx);
                    return;
                }
            } while (!await this.commit(cmds, ctx));
        }

        // this replaces MegaData.getShareNodesSync
        // if a backupid or an uploadid are supplied, only authorised share nodes are returned
        setRefShareNodes(sn, root) {
            const sh = [];
            const [h, a] = sn;
            const ss = a.join(',');

            let n = M.d[h];
            while (n && n.p) {
                if (u_sharekeys[n.h]) {
                    sh.push(n.h);
                }
                n = M.d[n.p];
            }

            if (root) {
                root.handle = n && n.h;
            }

            sn[1] = sh;
            return sh.join(',') !== ss;
        }

        // record share situation at the beginning of an ordinary (non-backup) upload
        snapshotUploadShares(uploadid, target) {
            // @todo fixme
            // this.uploads[uploadid] = [target, this.setRefShareNodes(target)];
        }

        // returns a data structure with all incomplete shares [[out],[in]]
        // with out/in arrays of strings concatenating the node with the peeruser handle
        getPendingShares() {
            const r = [[], []];
            const t = this.pendingoutshares;

            if (t) {
                for (let p = 0; p < t.length;) {
                    if (t[p]) {
                        p += t[p] + 7;
                    }
                    else {
                        // known user handle
                        r[0].push(ab_to_base64(new Uint8Array(t.buffer, t.byteOffset + p + 1, 14)));
                        p += 15;
                    }
                }

                for (const node in this.pendinginshares) {
                    const t = this.pendinginshares[node];
                    r[1].push(node + ab_to_base64(new Uint8Array(t.buffer, t.byteOffset, 8)));
                }
            }

            return r;
        }
    };
});

mBroadcaster.addListener('fm:initialized', () => {
    'use strict';

    if (folderlink) {
        return;
    }

    if (u_type > 0) {
        let state = null;

        Promise.all([authring.onAuthringReady('KeyMgr'), mega.keyMgr.getGeneration()])
            .then(([, keyMgrGeneration]) => {
                const keys = u_attr['^!keys'];
                const logger = MegaLogger.getLogger('KeyMgr');

                state = [
                    mega.keyMgr.version,
                    mega.keyMgr.generation,
                    keyMgrGeneration,
                    keys ? keys.length : -1
                ].join(':');

                if (!keyMgrGeneration && mega.keyMgr.version > 0) {
                    logger.error('Unstable local-storage...', state);
                    keyMgrGeneration = mega.keyMgr.generation;
                }

                if (keys) {
                    assert(!mega.keyMgr.pendingcommit, 'We were about to import keys, but there is a pending commit.');
                }
                else if (!keyMgrGeneration) {
                    assert(!mega.keyMgr.generation, `Unexpected State.`);
                }
                assert(window.u_privCu25519 && u_privCu25519.length === 32, 'Caught Invalid Cu25119 Key.');

                if (keys || !keyMgrGeneration) {
                    delete u_attr['^!keys'];

                    // Save now complete crypto state to ^!keys
                    return mega.keyMgr.initKeyManagement(keys)
                        .catch((ex) => {

                            if (keys && !mega.keyMgr.secure) {
                                logger.warn(ex);

                                mega.keyMgr.reset();
                                return mega.keyMgr.initKeyManagement();
                            }

                            throw ex;
                        });
                }
                else if (mega.keyMgr.pendingcommit) {
                    if (d) {
                        logger.warn('Dispatching pending commit...');
                    }
                    return mega.keyMgr.commit();
                }
            })
            .catch((ex) => {
                console.error(`key-manager error (${state})`, ex);

                if (!window.buildOlderThan10Days) {

                    eventlog(99811, JSON.stringify([4, String(ex).trim().split('\n')[0], state]));
                }
            });
    }

    return 0xDEAD;
});
