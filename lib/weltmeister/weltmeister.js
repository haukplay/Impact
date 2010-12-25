var wm = {};	
wm.entityFiles = [];

ig.module(
	'weltmeister.weltmeister'
)
.requires(
	'dom.ready',
	'impact.game',
	'weltmeister.evented-input',
	'weltmeister.config',
	'weltmeister.edit-map',
	'weltmeister.edit-entities',
	'weltmeister.select-file-dropdown',
	'weltmeister.modal-dialogs',
	'weltmeister.undo'
)
.defines(function() {

wm.Weltmeister = ig.Class.extend({	
	MODE: {
		DRAW: 1,
		TILESELECT: 2,
		ENTITYSELECT: 4
	},
	
	layers: [],
	entities: null,
	activeLayer: null,
	collisionLayer: null,
	selectedEntity: null,
	
	screen: {x: 0, y: 0},
	mouseLast: {x: -1, y: -1},
	waitForModeChange: false,
	
	tilsetSelectDialog: null,
	levelSavePathDialog: null,
	rot: 0,
	
	collisionSolid: 1,
	
	loadDialog: null,
	saveDialog: null,
	loseChangesDialog: null,
	fileName: 'untitled.js',
	modified: false,
	
	undo: null,
	
	init: function() {
		ig.editor = this;
		
		ig.system.context.textBaseline = 'top';
		ig.system.context.font = wm.config.labels.font;
		
			
		
		// Dialogs
		this.loadDialog = new wm.ModalDialogPathSelect( 'Load Level', 'Load', 'scripts' );
		this.loadDialog.onOk = this.load.bind(this);
		this.loadDialog.setPath( wm.config.project.levelPath );
		$('#levelLoad').bind( 'click', this.showLoadDialog.bind(this) );
		
		this.saveDialog = new wm.ModalDialogPathSelect( 'Save Level', 'Save', 'scripts' );
		this.saveDialog.onOk = this.save.bind(this);
		this.saveDialog.setPath( wm.config.project.levelPath );
		$('#levelSave').bind( 'click', this.saveDialog.open.bind(this.saveDialog) );
		
		this.loseChangesDialog = new wm.ModalDialog( 'Lose all changes?' );
		this.loseChangesDialog.onOk = this.loadDialog.open.bind(this.loadDialog);
		
		this.deleteLayerDialog = new wm.ModalDialog( 'Delete Layer? NO UNDO!' );
		this.deleteLayerDialog.onOk = this.removeLayer.bind(this);
		
		this.mode = this.MODE.DEFAULT;
		
		
		this.tilesetSelectDialog = new wm.SelectFileDropdown( '#layerTileset', wm.config.api.browse, 'images' );
		this.entities = new wm.EditEntities( $('#layerEntities') );
		
		$('#layers').sortable({
			update: this.reorderLayers.bind(this)
		});
		$('#layers').disableSelection();
		this.resetModified();
		
		
		// Events/Input
		for( key in wm.config.binds ) {
			ig.input.bind( ig.KEY[key], wm.config.binds[key] );
		}
		ig.input.keydownCallback = this.keydown.bind(this);
		ig.input.keyupCallback = this.keyup.bind(this);
		ig.input.mousemoveCallback = this.mousemove.bind(this);
		
		
		$(window).bind('keydown', this.uikeydown.bind(this) );
	
		$('#buttonAddLayer').bind( 'click', this.addLayer.bind(this) );
		$('#buttonRemoveLayer').bind( 'click', this.deleteLayerDialog.open.bind(this.deleteLayerDialog) );
		$('#buttonSaveLayerSettings').bind( 'click', this.saveLayerSettings.bind(this) );
		$('#reloadImages').bind( 'click', ig.Image.reloadCache );
		
		
		this.undo = new wm.Undo( wm.config.undoLevels );
	},
		
	
	uikeydown: function( event ) {
		if( event.target.type == 'text' ) {
			return;
		}
		
		var key = String.fromCharCode(event.which);
		if( key.match(/^\d$/) ) {
			var layer = key == '0' 
				? this.entities 
				: this.layers[ this.layers.length - parseInt(key) ];
				
			if( layer ) {
				if( event.shiftKey ) {
					layer.toggleVisibility();
				} else {
					this.setActiveLayer( layer.name );
				}
			}
		}
	},
	
	
	showLoadDialog: function() {
		if( this.modified ) {
			this.loseChangesDialog.open();
		} else {
			this.loadDialog.open();
		}
	},
	
	
	setModified: function() {
		if( !this.modified ) {
			this.modified = true;
			this.setWindowTitle();
		}
	},
	
	
	resetModified: function() {
		this.modified = false;
		this.setWindowTitle();
	},
	
	
	setWindowTitle: function() {
		document.title = this.fileName + (this.modified ? ' * ' : ' - ') + 'Weltmeister';
	},
	
	
	
	// -------------------------------------------------------------------------
	// Loading
	
	load: function( dialog, path ) {
		this.saveDialog.setPath( path );
		this.fileName = path.replace(/^.*\//,'');
		
		var req = $.ajax({
			url:( path + '?nocache=' + Math.random() ), 
			dataType: 'text',
			async:false,
			success:this.loadResponse.bind(this)
		});
	},
	
	loadResponse: function( data ) {
		
		// extract JSON from a module's JS
		var jsonMatch = data.match( /\/\*JSON\[\*\/([\s\S]*?)\/\*\]JSON\*\// );
		data = $.parseJSON( jsonMatch ? jsonMatch[1] : data );
		
		while( this.layers.length ) {
			this.layers[0].destroy();
			this.layers.splice( 0, 1 );
		}
		this.screen = {x: 0, y: 0};
		this.entities.clear();
		
		for( var i=0; i < data.entities.length; i++ ) {
			var ent = data.entities[i];
			this.entities.spawnEntity( ent.type, ent.x, ent.y, ent.settings );
		}
		
		for( var i=0; i < data.layer.length; i++ ) {
			var ld = data.layer[i];
			var newLayer = new wm.EditMap( ld.name, ld.tilesize, ld.tilesetName );
			newLayer.resize( ld.width, ld.height );
			newLayer.linkWithCollision = ld.linkWithCollision;
			newLayer.repeat = ld.repeat;
			newLayer.distance = ld.distance;
			newLayer.visible = !ld.visible;
			newLayer.data = ld.data;
			newLayer.toggleVisibility();
			this.layers.push( newLayer );
			
			if( ld.name == 'collision' ) {
				this.collisionLayer = newLayer;
			}
			
			this.setActiveLayer( ld.name );
		}
		
		this.setActiveLayer( 'entities' );
		
		this.reorderLayers();
		$('#layers').sortable('refresh');
		
		this.resetModified();
		this.undo.clear();
		this.draw();
	},
	
	
	
	// -------------------------------------------------------------------------
	// Saving
	
	save: function( dialog, path ) {
		this.fileName = path.replace(/^.*\//,'');
		var data = {
			'entities': this.entities.getSaveData(),
			'layer': []
		};
		
		var resources = [];
		for( var i=0; i < this.layers.length; i++ ) {
			var layer = this.layers[i];
			data.layer.push( layer.getSaveData() );
			if( layer.name != 'collision' ) {
				resources.push( layer.tiles.path );
			}
		}
		
		
		var dataString = $.toJSON(data);
		
		// Make it a ig.module instead of plain JSON?
		if( wm.config.project.outputFormat == 'module' ) {		
			var levelModule = path
				.replace(wm.config.project.modulePath, '')
				.replace(/\.js$/, '')
				.replace(/\//g, '.');
				
			var levelName = levelModule.replace(/^.*\.(\w)(\w*)$/, function( m, a, b ) {
				return a.toUpperCase() + b;
			});
			
			
			var resourcesString = '';
			if( resources.length ) {
				resourcesString = "Level" + levelName + "Resources=[new ig.Image('" +
					resources.join("'), new ig.Image('") +
				"')];\n";
			}
			
			// include /*JSON[*/ ... /*]JSON*/ markers, so we can easily load
			// this level as JSON again
			dataString =
				"ig.module( '"+levelModule+"' )\n" +
				".requires('impact.image')\n" +
				".defines(function(){\n"+
					"Level" + levelName + "=" +
						"/*JSON[*/" + dataString + "/*]JSON*/" +
					";\n" +
					resourcesString +
				"});";
		}
		
		var postString = 
			'path=' + encodeURIComponent( path ) +
			'&data=' + encodeURIComponent(dataString);
		
		var req = $.ajax({
			url: wm.config.api.save,
			type: 'POST',
			dataType: 'json',
			async:false,
			data: postString,
			success:this.saveResponse.bind(this)
		});
	},
	
	saveResponse: function( data ) {
		if( data.error ) {
			alert( 'Error: ' + data.msg );
		} else {
			this.resetModified();
		}
	},
	
	
	
	// -------------------------------------------------------------------------
	// Layers
	
	addLayer: function() {
		var name = 'new_layer_' + this.layers.length;
		var newLayer = new wm.EditMap( name, wm.config.layerDefaults.tilesize );
		newLayer.resize( wm.config.layerDefaults.width, wm.config.layerDefaults.height );
		newLayer.setScreenPos( this.screen.x, this.screen.y );
		this.layers.push( newLayer );
		this.setActiveLayer( name );
		this.updateLayerSettings();
		
		this.reorderLayers();
		
		$('#layers').sortable('refresh');
	},
	
	
	removeLayer: function() {
		var name = this.activeLayer.name;
		if( name == 'entities' ) {
			return false;
		}
		this.activeLayer.destroy();
		for( var i = 0; i < this.layers.length; i++ ) {
			if( this.layers[i].name == name ) {
				this.layers.splice( i, 1 );
				this.reorderLayers();
				$('#layers').sortable('refresh');
				this.setActiveLayer( 'entities' );
				return true;
			}
		}
		return false;
	},
	
	
	getLayerWithName: function( name ) {
		for( var i = 0; i < this.layers.length; i++ ) {
			if( this.layers[i].name == name ) {
				return this.layers[i];
			}
		}
		return null;
	},
	
	
	reorderLayers: function( dir ) {
		var newLayers = [];
		$('#layers div.layer span.name').each((function( newIndex, span ){
			var layer = this.getLayerWithName( $(span).text() );
			if( layer ) {
				layer.setHotkey( newIndex+1 );
				newLayers.unshift( layer );
			}
		}).bind(this));
		this.layers = newLayers;
		this.setModified();
		this.draw();
	},
	
	
	updateLayerSettings: function( ) {
		$('#layerName').val( this.activeLayer.name );
		$('#layerTileset').val( this.activeLayer.tilesetName );
		$('#layerTilesize').val( this.activeLayer.tilesize );
		$('#layerWidth').val( this.activeLayer.width );
		$('#layerHeight').val( this.activeLayer.height );
		$('#layerRepeat').attr( 'checked', this.activeLayer.repeat ? 'checked' : '' );
		$('#layerLinkWithCollision').attr( 'checked', this.activeLayer.linkWithCollision ? 'checked' : '' );
		$('#layerDistance').val( this.activeLayer.distance );
	},
	
	
	saveLayerSettings: function() {
		var newWidth = Math.floor($('#layerWidth').val());
		var newHeight = Math.floor($('#layerHeight').val());
		
		if( newWidth != this.activeLayer.width || newHeight != this.activeLayer.height ) {
			this.activeLayer.resize( newWidth, newHeight );
		}
		
		var newTilesetName = $('#layerTileset').val();
		if( newTilesetName != this.activeLayer.tilesetName ) {
			this.activeLayer.setTileset( newTilesetName );
		}
		
		var newName = $('#layerName').val();
		if( newName == 'collision' ) {
			// is collision layer
			this.collisionLayer = this.activeLayer;
		} 
		else if( this.activeLayer.name == 'collision' ) {
			// was collision layer, but is no more
			this.collisionLayer = null;
		}
		
		this.activeLayer.tilesize = Math.floor($('#layerTilesize').val());
		this.activeLayer.linkWithCollision = $('#layerLinkWithCollision').attr('checked') ? true : false;
		this.activeLayer.distance = $('#layerDistance').val();
		this.activeLayer.setName( newName );
		
		this.activeLayer.repeat = $('#layerRepeat').attr('checked') ? true : false;
		
		this.setModified();
		this.draw();
	},
	
	
	setActiveLayer: function( name ) {
		var previousLayer = this.activeLayer;
		this.activeLayer = ( name == 'entities' ? this.entities : this.getLayerWithName(name) );
		if( previousLayer == this.activeLayer ) {
			return; // nothing to do here
		}
		
		if( previousLayer ) {
			previousLayer.setActive( false );
		}
		this.activeLayer.setActive( true );
		this.mode = this.MODE.DEFAULT;
		
		
		if( name == 'entities' ) {
			$('#layerSettings').fadeOut(100);
		}
		else {
			this.entities.selectEntity( null );
			$('#layerSettings')
				.fadeOut(100,this.updateLayerSettings.bind(this))
				.fadeIn(100);
		}
		
		this.draw();
	},
	
	
	
	// -------------------------------------------------------------------------
	// Update
	
	mousemove: function() {
		if( !this.activeLayer ) {
			return;
		}
		
		if( this.mode == this.MODE.DEFAULT ) {
			
			// scroll map
			if( ig.input.state('drag') ) {
				this.screen.x -= ig.input.mouse.x - this.mouseLast.x;
				this.screen.y -= ig.input.mouse.y - this.mouseLast.y;
				for( var i = 0; i < this.layers.length; i++ ) {
					this.layers[i].setScreenPos( this.screen.x, this.screen.y );
				}
			}
			
			else if( ig.input.state('draw') ) {
				
				// move/scale entity
				if( this.activeLayer == this.entities ) {
					var x = ig.input.mouse.x + this.screen.x;
					var y = ig.input.mouse.y + this.screen.y;
					this.entities.dragOnSelectedEntity( x, y );
					this.setModified();
				}
				
				// draw on map
				else {
					this.setTileOnCurrentLayer();
				}
			}
			else if( this.activeLayer == this.entities ) {
				var x = ig.input.mouse.x + this.screen.x;
				var y = ig.input.mouse.y + this.screen.y;
				this.entities.mousemove( x, y );
			}
		}
		
		this.mouseLast = {x: ig.input.mouse.x, y: ig.input.mouse.y};
		this.draw();
	},
	
	
	keydown: function( action ) {
		if( !this.activeLayer ) {
			return;
		}
		
		if( action == 'draw' && this.mode == this.MODE.DEFAULT ) {
			// select entity
			if( this.activeLayer == this.entities ) {
				var x = ig.input.mouse.x + this.screen.x;
				var y = ig.input.mouse.y + this.screen.y;
				var entity = this.entities.selectEntityAt( x, y );
				if( entity ) {
					this.undo.beginEntityEdit( entity );
				}
			}
			else {
				this.undo.beginMapDraw();
				this.setTileOnCurrentLayer();
			}
		}
		document.activeElement.blur();
		this.draw();
	},
	
	
	keyup: function( action ) {
		if( !this.activeLayer ) {
			return;
		}
		
		if( action == 'delete' ) {
			this.entities.deleteSelectedEntity();
			this.setModified();
		}
		
		else if( action == 'clone' ) {
			this.entities.cloneSelectedEntity();
			this.setModified();
		}
		
		else if( action == 'menu' ) {
			if( this.mode != this.MODE.TILESELECT && this.mode != this.MODE.ENTITYSELECT ) {
				if( this.activeLayer == this.entities ) {
					this.mode = this.MODE.ENTITYSELECT;
					this.entities.showMenu( ig.input.mouse.x, ig.input.mouse.y );
				}
				else {
					this.mode = this.MODE.TILESELECT;
					this.activeLayer.tileSelect.setPosition( ig.input.mouse.x, ig.input.mouse.y );
				}
			} else {
				this.mode = this.MODE.DEFAULT;
				this.entities.hideMenu();
			}
		}
		
		
		if( action == 'draw' ) {			
			// select tile
			if( this.mode == this.MODE.TILESELECT ) {	
				var tile = this.activeLayer.tileSelect.selectTile( ig.input.mouse.x, ig.input.mouse.y );
				this.activeLayer.currentTile = tile;
				this.mode = this.MODE.DEFAULT;
			}
			else if( this.activeLayer == this.entities ) {
				this.undo.endEntityEdit();
			}
			else {
				this.undo.endMapDraw();
			}
		}
		
		if( action == 'undo' ) {
			this.undo.undo();
		}
		
		if( action == 'redo' ) {
			this.undo.redo();
		}
		
		this.draw();
		this.mouseLast = {x: ig.input.mouse.x, y: ig.input.mouse.y};
	},
	
	
	setTileOnCurrentLayer: function() {
		if( !this.activeLayer || !this.activeLayer.scroll ) {
			return;
		}
		
		var x = ig.input.mouse.x + this.activeLayer.scroll.x;
		var y = ig.input.mouse.y + this.activeLayer.scroll.y;
		var oldTile = this.activeLayer.getTile(x, y);
		if( this.activeLayer.currentTile !=  oldTile ) {
			
			this.activeLayer.setTile( x, y, this.activeLayer.currentTile );
			this.undo.pushMapDraw( this.activeLayer, x, y, oldTile, this.activeLayer.currentTile );
			
			if( 
				this.activeLayer.linkWithCollision && 
				this.collisionLayer && 
				this.collisionLayer != this.activeLayer
			) {
				var collisionLayerTile = this.activeLayer.currentTile > 0 ? this.collisionSolid : 0;
				
				var oldCollisionTile = this.collisionLayer.getTile(x, y);
				this.collisionLayer.setTile( x, y, collisionLayerTile );
				this.undo.pushMapDraw( this.collisionLayer, x, y, oldCollisionTile, collisionLayerTile );
			}
			
			this.setModified();
		}
	},
	
	
	// -------------------------------------------------------------------------
	// Drawing
	
	draw: function() {
		ig.system.clear( wm.config.colors.clear );
	
		for( var i = 0; i < this.layers.length; i++ ) {
			this.layers[i].draw();
		}
		this.entities.draw();
		
		if( this.activeLayer ) {
			if( this.mode == this.MODE.TILESELECT ) {
				this.activeLayer.tileSelect.draw();
				this.activeLayer.tileSelect.drawCursor( ig.input.mouse.x, ig.input.mouse.y );
			}
			
			if( this.mode == this.MODE.DEFAULT ) {
				this.activeLayer.drawCursor( ig.input.mouse.x, ig.input.mouse.y );
			}
		}
		
		if( wm.config.labels.draw ) {
			this.drawLabels( wm.config.labels.step );
		}
	},
	
	
	drawLabels: function( step ) {
		ig.system.context.fillStyle = wm.config.colors.primary;
		var xlabel = this.screen.x - this.screen.x % step - step;
		for( var tx = (-this.screen.x % step).floor(); tx < ig.system.width; tx += step ) {
			xlabel += step;
			ig.system.context.fillText( xlabel, tx * ig.system.scale, 0 );
		}
		
		var ylabel = this.screen.y - this.screen.y % step - step;
		for( var ty = (-this.screen.y % step).floor(); ty < ig.system.height; ty += step ) {
			ylabel += step;
			ig.system.context.fillText( ylabel, 0,  ty * ig.system.scale );
		}
	},
	
	
	getEntityByName: function( name ) {
		return this.entities.getEntityByName( name );
	}
});



// Create a custom loader, to skip sound files and the run loop creation
wm.Loader = ig.Loader.extend({
	end: function() {
		if( this.done ) { return; }
		
		clearInterval( this._intervalId );
		this.done = true;
		ig.system.clear( wm.config.colors.clear );
		ig.game = new (this.gameClass)();
	},
	
	loadResource: function( res ) {
		if( res instanceof ig.Sound ) {
			this._unloaded.erase( res.path );
		}
		else {
			this.parent( res );
		}
	}
});


// Init!
ig.system = new ig.System(
	'#canvas', 1,
	wm.config.view.width / wm.config.view.zoom, 
	wm.config.view.height / wm.config.view.zoom, 
	wm.config.view.zoom
);
	
ig.input = new wm.EventedInput();
ig.soundManager = new ig.SoundManager();
ig.ready = true;

var loader = new wm.Loader( wm.Weltmeister, ig.resources );
loader.load();

});

