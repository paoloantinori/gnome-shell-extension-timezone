import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {md5Hash, getSharedSession} from './util.js';

let peopleCount = 0;

export function resetPeopleCount() {
    peopleCount = 0;
}

export class Person extends Signals.EventEmitter {
    constructor(params) {
        super();

        this.id = ++peopleCount;
        this.name = params.name || '';
        this.city = params.city || '';
        this.tz = params.tz;
        this.avatar = params.avatar;
        this.github = params.github;
        this.gravatar = params.gravatar;
        this._githubToken = params._githubToken;

        // Track active cancellables for cleanup
        this._cancellables = [];

        this._insertDateTime();
        this._getRemoteInfo();
    }

    getName() {
        return this.name || (this.github ? this.github : `Person ${this.id}`);
    }

    _insertDateTime() {
        this.tz1 = GLib.TimeZone.new(this.tz);
        this.now = GLib.DateTime.new_now(this.tz1);
        this.offset = this.now.get_utc_offset() / (3600 * 1000 * 1000);
    }

    _getRemoteInfo() {
        // We have all data, no need to retrieve external data
        if (this.name && this.city && this.avatar)
            return;

        if (this.github) {
            this._getGithubInfo();
            return;
        }

        if (this.gravatar) {
            this._getGravatarInfo();
        }
    }

    _getGithubInfo() {
        const session = getSharedSession();
        const url = `https://api.github.com/users/${this.github}`;
        const message = Soup.Message.new('GET', url);

        // Set required headers
        message.get_request_headers().append('User-Agent', 'GNOME-Shell-Timezone-Extension/1.0');
        if (this._githubToken)
            message.get_request_headers().append('Authorization', `Bearer ${this._githubToken}`);

        // Create and track cancellable
        const cancellable = new Gio.Cancellable();
        this._cancellables.push(cancellable);

        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT,
            cancellable,
            (sess, result) => {
                try {
                    if (message.get_status() !== Soup.Status.OK) {
                        log(`Error ${message.get_status()} fetching data from github for user ${this.github}`);
                        return;
                    }

                    const bytes = sess.send_and_read_finish(result);
                    const decoder = new TextDecoder('utf-8');
                    const responseData = decoder.decode(bytes.get_data());
                    const p = JSON.parse(responseData);

                    if (!this.avatar && p.avatar_url)
                        this.avatar = p.avatar_url;

                    if (!this.name && p.name)
                        this.name = p.name;

                    if (!this.city && p.location)
                        this.city = p.location;

                    this.emit('changed');
                } catch (e) {
                    log(`Error fetching github data for user ${this.github}: ${e}`);
                } finally {
                    // Clean up cancellable
                    const index = this._cancellables.indexOf(cancellable);
                    if (index > -1) {
                        this._cancellables.splice(index, 1);
                    }
                }
            }
        );
    }

    // Cancel all pending requests (call on destroy)
    _cancelRequests() {
        for (const cancellable of this._cancellables) {
            cancellable.cancel();
        }
        this._cancellables = [];
    }

    _getGravatarInfo() {
        if (this.avatar)
            return;

        const email = this.gravatar.trim().toLowerCase();
        this.avatar = `http://cdn.libravatar.org/avatar/${md5Hash(email)}`;
    }
}
