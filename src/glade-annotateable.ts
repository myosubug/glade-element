import {LitElement, html, customElement, property, css} from 'lit-element';
import '@material/mwc-dialog';
import '@material/mwc-button';
import '@material/mwc-textfield';
import '@material/mwc-textarea';

import firebase from 'firebase';

// Different views the modal may reflect
enum DialogRole {
  List = 'LIST', // Listing annotations in the modal
  Create = 'CREATE', // Annotation creation form
  Login = 'LOGIN', // User authentication form
}

@customElement('glade-annotateable')
export class GladeAnnotateable extends LitElement {
  /**
   * The content nodes inside the tag
   */
  gladeContentNodes: NodeListOf<Element>;

  /**
   * Verbosity of logs
   */
  @property({type: Boolean})
  verbose = false;

  @property({type: Number, reflect: true})
  gladeDocumentHash = 0;

  /**
   * Whether or not the Glade dialog is currently opened
   */
  @property({type: Boolean})
  annotationsModalOpened = false;

  /**
   * The current login form error message
   */
  @property({type: String})
  loginErrorMessage = '';

  /**
   * An object with all firebase configuration options, traditionally this config should not be published, but the embeddable nature of <glade-component> seems to be an exception
   */
  firebaseConfig = {
    apiKey: 'AIzaSyAtc2ed5rsHT7IOF9E1psFhkqtCqKib25U',
    authDomain: 'glade-software-firebase.firebaseapp.com',
    databaseURL: 'https://glade-software-firebase.firebaseio.com',
    projectId: 'glade-software-firebase',
    storageBucket: 'glade-software-firebase.appspot.com',
    messagingSenderId: '527964919900',
    appId: '1:527964919900:web:dc1ffc9e14a70b08b3ae99',
  };

  /**
   * the current firebase instance
   */
  firebase: any;

  /**
   * the current firestore database instance
   */
  db!: firebase.firestore.Firestore;

  /**
   * the active firebase user
   */
  user!: firebase.User | null;

  /**
   * the email currently being used to sign in
   */
  @property({type: String})
  email = '';

  /**
   * the password currently being used to sign in
   */
  @property({type: String})
  password = '';

  /**
   * the body of the annotation that is currently being composed
   */
  @property({type: String})
  pendingAnnotationBody = '';

  /**
   * the index of the referrent DOM node for the pending annotation
   */
  @property({type: Number})
  pendingGladeDomNodeHash = 0;

  /**
   * an array of all annotations for this document
   */
  @property({type: Array})
  annotations: Array<{
    body: string;
    gladeDomNodeHash: number;
    postedBy: string | undefined;
  }> = [];

  /**
   * an array of all annotations that are currently listed for the selected referrent
   */
  @property({type: Array})
  activeAnnotations: Array<{
    body: string;
    gladeDomNodeHash: number;
    postedBy: string | undefined;
  }> = [];

  /**
   * the current UI mode of the Glade dialog
   * List, Create, or Login
   */
  @property({type: String})
  dialogRole: DialogRole = DialogRole.List;

  static styles = css`
    :host {
      display: block;
      padding: 16px;
      max-width: 800px;
    }
    .create-annotation-form {
      min-width: 320px;
    }
    .dialog {
      width: 60%;
      margin: 20%;
    }
    .large {
      font-size: x-large;
    }
  `;

  constructor() {
    super();
    this.gladeContentNodes = this.querySelectorAll('glade-annotateable > *');
  }

  log(...messages: String[]) {
    if (this.verbose) console.log(...messages);
  }

  handleEmailInputChange(ev: Event) {
    const inputEl = ev.composedPath()[0] as HTMLInputElement;
    this.email = inputEl.value;
  }

  handlePasswordInputChange(ev: Event) {
    const inputEl = ev.composedPath()[0] as HTMLInputElement;
    this.password = inputEl.value;
  }

  handleAnnotationBodyChange(ev: Event) {
    const inputEl = ev.composedPath()[0] as HTMLInputElement;
    this.pendingAnnotationBody = inputEl.value;
  }

  /**
   * hashString https://stackoverflow.com/a/8831937/2183475
   * @param stringToHash the string we wish to hash
   */

  hashString(stringToHash: string): string {
    var hash = 0;

    if (stringToHash.length == 0) {
      return `${hash}`;
    }

    for (var i = 0; i < stringToHash.length; i++) {
      var char = stringToHash.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }

    return `${hash}`;
  }

  /**
   * the template to display when in Login DialogRole
   */
  get loginTemplate() {
    if (this.user) return html``;
    return html`
      <div
        id="loginTemplate"
        style="border: 1px solid; margin:8px; padding:8px;"
      >
        <p>you need an account to add annotations</p>
        <input
          name="email"
          placeholder="email"
          type="email"
          @change="${this.handleEmailInputChange}"
        />
        <input
          name="password"
          placeholder="password"
          type="password"
          @change="${this.handlePasswordInputChange}"
        />
      </div>
      <div style="color:red;">${this.loginErrorMessage}</div>
      <mwc-button slot="secondaryAction"
        ><a
          href="https://glade.app/signup?from=${encodeURIComponent(
            window.location.href
          )}"
          >sign up?</a
        ></mwc-button
      >
      <mwc-button slot="primaryAction" @click=${this.handleClickLogin}
        >Sign in!</mwc-button
      >
    `;
  }

  /**
   * the template to display when in Create DialogRole
   */
  get createAnnotationTemplate() {
    return html`
      <mwc-textarea
        style="width:500px; margin:8px; padding:8px;"
        placeholder=""
        @change=${this.handleAnnotationBodyChange}
      ></mwc-textarea>
      <mwc-button
        slot="secondaryAction"
        @click=${this.handleClickPublishAnnotation}
        >Publish Annotation!</mwc-button
      >
    `;
  }
  /**
   * the template to display when in List DialogRole
   */
  get annotationsListTemplate() {
    return html`<div>
        ${this.activeAnnotations.length
          ? this.activeAnnotations.map((annotation) => {
              return html`<div
                style="border: 1px solid; margin:8px; padding:8px;"
              >
                <span style="color: #1A535C;"
                  >${annotation.postedBy || 'anonymous'}</span
                >:
                <p>${annotation.body}</p>
              </div>`;
            })
          : 'No annotations here yet!'}
      </div>
      <mwc-button
        class="button-cta"
        slot="primaryAction"
        @click=${this.handleClickCreateAnnotation}
        >Create Annotation!</mwc-button
      > `;
  }

  /**
   * the current template to display in the dialog
   */
  get modalContent() {
    switch (this.dialogRole) {
      case DialogRole.List:
        return this.annotationsListTemplate;
      case DialogRole.Login:
        return this.loginTemplate;
      case DialogRole.Create:
        return this.createAnnotationTemplate;
      default:
        return html`DialogRole Error`;
    }
  }

  annotationsForHash(domNodeHash: number) {
    return this.annotations.filter(
      (annotation) => annotation.gladeDomNodeHash === domNodeHash
    );
  }

  initializeFirebase() {
    if (!firebase.apps.length) {
      firebase.initializeApp(this.firebaseConfig);
    }

    this.db = firebase.firestore();
    this.user = firebase.auth().currentUser;

    firebase.auth().onAuthStateChanged(this.handleAuthStateChanged.bind(this));
  }

  async handleAuthStateChanged(u: firebase.User | null) {
    if (u) {
      this.user = u;
      const userDocRef = await this.db
        .collection('users')
        .doc(this.user.uid)
        .get();

      const displayName = userDocRef?.data()?.displayName;

      if (displayName) {
        this.user.updateProfile({displayName});
      }
    } else {
      this.user = null;
    }
    this.requestUpdate();
  }

  async getAnnotationsFromDB() {
    this.log(
      'fetching annotations for glade-tree',
      `${this.gladeDocumentHash}`
    );

    const annotationSnapshots = await this.db
      .collection(`glade-trees`)
      .doc(`${this.gladeDocumentHash}`)
      .collection(`annotations`)
      .get();

    annotationSnapshots.forEach((document) => {
      const {body, postedBy, gladeDomNodeHash} = document.data();
      this.annotations.push({
        body,
        postedBy,
        gladeDomNodeHash,
      });
    });
  }

  async connectedCallback() {
    super.connectedCallback();
    this.initializeFirebase();

    let nodeHashes: string[] = [];

    this.gladeContentNodes.forEach((node: Element) => {
      const gladeNodeHash = this.hashString(node.textContent || '');
      node.setAttribute('data-glade-node-hash', gladeNodeHash);
      nodeHashes.push(gladeNodeHash);
    });

    const docHash: string = this.hashString(nodeHashes.join('_'));
    this.gladeDocumentHash = parseInt(docHash);

    await this.getAnnotationsFromDB();

    this.processAnnotations();
  }

  processAnnotations() {
    this.gladeContentNodes.forEach((node) => {
      const nodeHash = parseInt(
        node.getAttribute('data-glade-node-hash') || '0'
      );

      // aggregate all annotations for a given node index in the DOM
      const annotationsForHash = this.annotations.filter(
        ({gladeDomNodeHash}) => {
          return gladeDomNodeHash == nodeHash;
        }
      );

      // if a node index has annotations, give it a class for CSS styles and a click listener
      if (annotationsForHash.length) {
        node.classList.add('glade-has-annotations');
      } else {
        // clear class if it is wrongly present on a DOM node that has no annotations
        node.classList.remove('glade-has-annotations');
      }
    });
  }

  handleClickCreateAnnotation(_: MouseEvent) {
    if (this.user) {
      this.dialogRole = DialogRole.Create;
    } else {
      this.dialogRole = DialogRole.Login;
    }
    this.requestUpdate();
  }

  async handleClickPublishAnnotation(_: MouseEvent) {
    this.log('publish button clicked');
    const postedBy = this.user?.displayName;
    const body = this.pendingAnnotationBody;

    const gladeDomNodeHash = this.pendingGladeDomNodeHash;
    this.log('publishing annotation with nodeHash', `${gladeDomNodeHash}`);

    let annotationDocument = {
      postedBy: postedBy || undefined,
      body,
      gladeDomNodeHash,
    };

    await this.db
      .collection('glade-trees')
      .doc(`${this.gladeDocumentHash}`)
      .collection('annotations')
      .add(annotationDocument);

    this.annotationsModalOpened = false;
    this.dialogRole = DialogRole.List;

    this.annotations.push(annotationDocument);

    this.processAnnotations();
  }

  async handleClickLogin(_: MouseEvent) {
    try {
      await firebase
        .auth()
        .signInWithEmailAndPassword(this.email, this.password);
      this.annotationsModalOpened = false;
    } catch (error) {
      let beLouder = !!this.loginErrorMessage;

      if (error.code === 'auth/wrong-password') {
        this.loginErrorMessage = 'password incorrect!';
        this.log('wrong password');
      } else if (error.code === 'auth/user-not-found') {
        this.loginErrorMessage = 'no user with that email!';
        this.log('user not found');
      } else if (error.code === 'auth/too-many-requests') {
        this.loginErrorMessage = 'too many attempts, try again later';
      }
      if (beLouder) {
        this.loginErrorMessage += '!';
      }
    }
    this.requestUpdate();
  }

  handleMouseUpOnChildren(ev: MouseEvent) {
    if (ev.button === 0) {
      // deepest node in DOM tree that recieved this event
      const targetNode = ev?.composedPath()[0] as Element;

      const gladeDomNodeHash: number = parseInt(
        targetNode.getAttribute('data-glade-node-hash') as string
      );

      this.pendingGladeDomNodeHash = gladeDomNodeHash;

      this.activeAnnotations = this.annotationsForHash(gladeDomNodeHash);
      this.annotationsModalOpened = true;
      this.requestUpdate();
    }
  }

  render() {
    return html`<mwc-dialog
        @closed=${() => {
          this.annotationsModalOpened = false;
          this.dialogRole = DialogRole.List;
        }}
        heading="annotations"
        ?open=${this.annotationsModalOpened}
      >
        ${this.modalContent}
      </mwc-dialog>
      <slot @mouseup=${this.handleMouseUpOnChildren.bind(this)}></slot>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'glade-annotateable': GladeAnnotateable;
  }
}
