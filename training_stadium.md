{

	"name" : "Classic",

	"width" : 420,

	"height" : 200,

	"spawnDistance" : 170,

	"bg" : { "type" : "grass", "width" : 370, "height" : 170, "kickOffRadius" : 75, "cornerRadius" : 0 },

	"vertexes" : [
		/* 0 */ { "x" : -370, "y" : 170, "trait" : "ballArea" },
		/* 1 */ { "x" : -370, "y" : 64, "trait" : "ballArea" },
		/* 2 */ { "x" : -370, "y" : -64, "trait" : "ballArea" },
		/* 3 */ { "x" : -370, "y" : -170, "trait" : "ballArea" },
		/* 4 */ { "x" : 370, "y" : 170, "trait" : "ballArea" },
		/* 5 */ { "x" : 370, "y" : 64, "trait" : "ballArea" },
		/* 6 */ { "x" : 370, "y" : -64, "trait" : "ballArea" },
		/* 7 */ { "x" : 370, "y" : -170, "trait" : "ballArea" },
		
		/* 8 */ { "x" : 0, "y" : 200, "trait" : "kickOffBarrier" },
		/* 9 */ { "x" : 0, "y" : 75, "trait" : "kickOffBarrier" },
		/* 10 */ { "x" : 0, "y" : -75, "trait" : "kickOffBarrier" },
		/* 11 */ { "x" : 0, "y" : -200, "trait" : "kickOffBarrier" },
		
		/* 12 */ { "x" : -380, "y" : -64, "trait" : "goalNet" },
		/* 13 */ { "x" : -400, "y" : -44, "trait" : "goalNet" },
		/* 14 */ { "x" : -400, "y" : 44, "trait" : "goalNet" },
		/* 15 */ { "x" : -380, "y" : 64, "trait" : "goalNet" },
		/* 16 */ { "x" : 380, "y" : -64, "trait" : "goalNet" },
		/* 17 */ { "x" : 400, "y" : -44, "trait" : "goalNet" },
		/* 18 */ { "x" : 400, "y" : 44, "trait" : "goalNet" },
		/* 19 */ { "x" : 380, "y" : 64, "trait" : "goalNet" }

	],

	"segments" : [
		{ "v0" : 0, "v1" : 1, "trait" : "ballArea" },
		{ "v0" : 2, "v1" : 3, "trait" : "ballArea" },
		{ "v0" : 4, "v1" : 5, "trait" : "ballArea" },
		{ "v0" : 6, "v1" : 7, "trait" : "ballArea" },
		
		{ "v0" : 12, "v1" : 13, "trait" : "goalNet", "curve" : -90 },
		{ "v0" : 13, "v1" : 14, "trait" : "goalNet" },
		{ "v0" : 14, "v1" : 15, "trait" : "goalNet", "curve" : -90 },
		{ "v0" : 16, "v1" : 17, "trait" : "goalNet", "curve" : 90 },
		{ "v0" : 17, "v1" : 18, "trait" : "goalNet" },
		{ "v0" : 18, "v1" : 19, "trait" : "goalNet", "curve" : 90 },
		
		{ "v0" : 8, "v1" : 9, "trait" : "kickOffBarrier" },
		{ "v0" : 9, "v1" : 10, "trait" : "kickOffBarrier", "curve" : 180, "cGroup" : ["blueKO" ] },
		{ "v0" : 9, "v1" : 10, "trait" : "kickOffBarrier", "curve" : -180, "cGroup" : ["redKO" ] },
		{ "v0" : 10, "v1" : 11, "trait" : "kickOffBarrier" }

	],

	"goals" : [
		

	],

	"discs" : [
		{ "pos" : [-370,64 ], "trait" : "goalPost", "color" : "FFCCCC" },
		{ "pos" : [-370,-64 ], "trait" : "goalPost", "color" : "FFCCCC" },
		{ "pos" : [370,64 ], "trait" : "goalPost", "color" : "CCCCFF" },
		{ "pos" : [370,-64 ], "trait" : "goalPost", "color" : "CCCCFF" }

	],

	"planes" : [
		{ "normal" : [0,1 ], "dist" : -170, "trait" : "ballArea" },
		{ "normal" : [0,-1 ], "dist" : -170, "trait" : "ballArea" },
		
		{ "normal" : [0,1 ], "dist" : -200, "bCoef" : 0.1 },
		{ "normal" : [0,-1 ], "dist" : -200, "bCoef" : 0.1 },
		{ "normal" : [1,0 ], "dist" : -420, "bCoef" : 0.1 },
		{ "normal" : [-1,0 ], "dist" : -420, "bCoef" : 0.1 }

	],

	"traits" : {
		"ballArea" : { "vis" : false, "bCoef" : 1, "cMask" : ["ball" ] },
		"goalPost" : { "radius" : 8, "invMass" : 0, "bCoef" : 0.5 },
		"goalNet" : { "vis" : true, "bCoef" : 0.1, "cMask" : ["ball" ] },
		"kickOffBarrier" : { "vis" : false, "bCoef" : 0.1, "cGroup" : ["redKO","blueKO" ], "cMask" : ["red","blue" ] }

	}
}