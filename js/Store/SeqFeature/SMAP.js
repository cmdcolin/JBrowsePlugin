define( [
            'dojo/_base/declare',
            'dojo/_base/lang',
            'dojo/_base/array',
            'dojo/Deferred',
            'JBrowse/Model/SimpleFeature',
            'JBrowse/Store/SeqFeature',
            'JBrowse/Store/DeferredFeaturesMixin',
            'JBrowse/Store/DeferredStatsMixin',
            'JBrowse/Store/SeqFeature/GlobalStatsEstimationMixin',
            'JBrowse/Model/XHRBlob',
            './SMAP/Parser'
        ],
        function(
            declare,
            lang,
            array,
            Deferred,
            SimpleFeature,
            SeqFeatureStore,
            DeferredFeatures,
            DeferredStats,
            GlobalStatsEstimationMixin,
            XHRBlob,
            Parser
        ) {

return declare([ SeqFeatureStore, DeferredFeatures, DeferredStats, GlobalStatsEstimationMixin ],

 /**
  * @lends JBrowse.Store.SeqFeature.GFF3
  */
{
    constructor: function( args ) {
        this.data = args.blob ||
            new XHRBlob( this.resolveUrl(
		this._evalConf(args.urlTemplate)
                         )
                       );
        this.features = [];
        var defaultRefNames = { 1 : "chr1",
2 : "chr2",
3 : "chr3", 
4 : "chr4",
5 : "chr5",
6 : "chr6",
7 : "chr7",
8 : "chr8",
9  : "chr9",
10 : "chr10",
11 : "chr11",
12 : "chr12",
13 : "chr13",
14 : "chr14",
15 : "chr15",
16 : "chr16",
17 : "chr17",
18 : "chr18",
19 : "chr19",
20 : "chr20",
21 : "chr21",
22 : "chr22",
23 : "chrX",
24 : "chrY"};
        this.referenceNames = args.referenceNames || defaultRefNames;
        this._loadFeatures();
    },

    _loadFeatures: function() {
        var thisB = this;
        var features = this.bareFeatures = [];

        var featuresSorted = true;
        var seenRefs = this.refSeqs = {};
        var first = true;
        var parser = new Parser(
            {
                featureCallback: function(fs) {
                    array.forEach( fs, function( feature ) {   
                        if(first)
                        {
                            features.push({
                                start:1,
                                end : thisB.browser.refSeq.length,
                                seq_id : thisB.browser.refSeq.name,
                                name : "SMAP",
                                type : "Reference SMAP",
                                attributes : {"ID":["SMAP_Track"]}
                            });
                            first = false;
                        }
                        feature.seq_id = thisB.referenceNames[feature.seq_id];
                        // if(feature.type == "insertion" || feature.type == "deletion")
                        // {
                            var prevFeature = features[ features.length-1 ];
                            var regRefName = thisB.browser.regularizeReferenceName( feature.seq_id );
                            if( regRefName in seenRefs && prevFeature && prevFeature.seq_id != feature.seq_id )
                               featuresSorted = false;
                            if( prevFeature && prevFeature.seq_id == feature.seq_id && feature.start < prevFeature.start )
                               featuresSorted = false;

                            if( !( regRefName in seenRefs ))
                               seenRefs[ regRefName ] = features.length;
                            if(!features[0].subfeatures)
                                features[0].subfeatures = [];
                            if(feature.seq_id==thisB.browser.refSeq.name)
                                features[0].subfeatures.push(feature);
                            // features.push(feature);
                        // }                       
                   });
                },
                endCallback:     function()  {
                    if( ! featuresSorted ) {
                        features.sort( thisB._compareFeatureData );
                        // need to rebuild the refseq index if changing the sort order
                        thisB._rebuildRefSeqs( features );
                    }

                    thisB._estimateGlobalStats()
                         .then( function( stats ) {
                                    thisB.globalStats = stats;
                                    thisB._deferred.stats.resolve();
                                });

                    thisB._deferred.features.resolve( features );
                }
            });
        var fail = lang.hitch( this, '_failAllDeferred' );
        // parse the whole file and store it
        this.data.fetchLines(
            function( line ) {
                try {
                    parser.addLine(line);
                } catch(e) {
                    fail('Error parsing GFF3.');
                    throw e;
                }
            },
            lang.hitch( parser, 'finish' ),
            fail
        );
    },

    _rebuildRefSeqs: function( features ) {
        var refs = {};
        for( var i = 0; i<features.length; i++ ) {
            var regRefName = this.browser.regularizeReferenceName( features[i].seq_id );

            if( !( regRefName in refs ) )
                refs[regRefName] = i;
        }
        this.refSeqs = refs;
    },

    _compareFeatureData: function( a, b ) {
        if( a.seq_id < b.seq_id )
            return -1;
        else if( a.seq_id > b.seq_id )
            return 1;

        return a.start - b.start;
    },

    _getFeatures: function( query, featureCallback, finishedCallback, errorCallback ) {
        var thisB = this;
        thisB._deferred.features.then( function() {
            thisB._search( query, featureCallback, finishedCallback, errorCallback );
        });
    },

    _search: function( query, featureCallback, finishCallback, errorCallback ) {
        // search in this.features, which are sorted
        // by ref and start coordinate, to find the beginning of the
        // relevant range
        var bare = this.bareFeatures;
        var converted = this.features;

        var refName = this.browser.regularizeReferenceName( query.ref );

        var i = this.refSeqs[ refName ];
        if( !( i >= 0 )) {
            finishCallback();
            return;
        }

        var checkEnd = 'start' in query
            ? function(f) { return f.get('end') >= query.start; }
            : function() { return true; };

        for( ; i<bare.length; i++ ) {
            // lazily convert the bare feature data to JBrowse features
            var f = converted[i] ||
                ( converted[i] = function(b,i) {
                      bare[i] = false;
                      return this._formatFeature( b );
                  }.call( this, bare[i], i )
                );
            // features are sorted by ref seq and start coord, so we
            // can stop if we are past the ref seq or the end of the
            // query region
            if( f._reg_seq_id != refName || f.get('start') > query.end )
                break;

            if( checkEnd( f ) ) {
                featureCallback( f );
            }
        }

        finishCallback();
    },

    _formatFeature: function( data ) {
        var f = new SimpleFeature({
            data: this._featureData( data ),
            id: (data.attributes.ID||[])[0]
        });
        f._reg_seq_id = this.browser.regularizeReferenceName( data.seq_id );
        return f;
    },

    // flatten array like [ [1,2], [3,4] ] to [ 1,2,3,4 ]
    _flattenOneLevel: function( ar ) {
        var r = [];
        for( var i = 0; i<ar.length; i++ ) {
            r.push.apply( r, ar[i] );
        }
        return r;
    },

    _featureData: function( data ) {
        var f = lang.mixin( {}, data );
        // f.subfeatures = [
        // {
        //     seq_id : f.seq_id,
        //     type : f.Type,
        //     start : f.start,
        //     end : f.end
        // }];

        return f;
    },

    /**
     * Interrogate whether a store has data for a given reference
     * sequence.  Calls the given callback with either true or false.
     *
     * Implemented as a binary interrogation because some stores are
     * smart enough to regularize reference sequence names, while
     * others are not.
     */
    hasRefSeq: function( seqName, callback, errorCallback ) {
        var thisB = this;
        this._deferred.features.then( function() {
            callback( thisB.browser.regularizeReferenceName( seqName ) in thisB.refSeqs );
        });
    }

});
});
